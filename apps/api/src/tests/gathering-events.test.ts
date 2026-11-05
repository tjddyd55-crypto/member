import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { currentJobSecret } from '../modules/gathering/routes/schedule.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';
import { usePushSender } from '../modules/gathering/push/service.js';
import { ExpoPushSender, RecordingPushSender } from '../modules/gathering/push/sender.js';
import { buildGatheringObjectKey, createGatheringUploadTarget } from '../modules/gathering/storage/r2.js';
import { AppError } from '../lib/errors.js';

let app: FastifyInstance;
const userIds: string[] = [];
const groupIds: string[] = [];
const sender = new RecordingPushSender();

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  gatheringAuthLimiter.reset();
  sender.sent.length = 0;
  sender.nextReason = 'ok';
  usePushSender(sender);
});

afterAll(async () => {
  usePushSender(new ExpoPushSender());
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function register(name: string) {
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: {
      name,
      phone,
      password: 'Passw0rd!',
      localJcName: '서울테스트',
      directoryConsent: true,
    },
  });
  expect(res.statusCode).toBe(200);
  userIds.push(res.json().user.id);
  return res.json() as {
    tokens: { accessToken: string };
    user: { id: string };
  };
}

async function createGroup(token: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: auth(token),
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id);
  return res.json() as { id: string };
}

describe('행사, 캘린더, 참석, 알림', () => {
  it('총무와 회장만 행사를 만들고, 회원은 참석만 바꾼다', async () => {
    const owner = await register('행사회장');
    const member = await register('행사회원');
    const outsider = await register('행사외부');
    const group = await createGroup(owner.tokens.accessToken, '행사 모임');
    const other = await createGroup(outsider.tokens.accessToken, '다른 행사 모임');
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${other.id}/events`,
      headers: auth(outsider.tokens.accessToken),
      payload: { title: '외부 행사', startsAt },
    });
    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: { requiresApproval: false },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: auth(member.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/gathering/push/tokens',
      headers: auth(member.tokens.accessToken),
      payload: { permission: 'granted', platform: 'ANDROID', token: `ExponentPushToken[member-${member.user.id}]` },
    });

    const denied = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: auth(member.tokens.accessToken),
      payload: { title: '회원 행사', startsAt },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '월례모임', startsAt, place: '회의실', endsAt: null },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().groupName).toBe('행사 모임');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toContain(member.user.id);
    expect(sender.sent[0]?.title).toBe('JCI KOREA');

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/events?from=2020-01-01T00:00:00.000Z&to=2035-01-01T00:00:00.000Z`,
      headers: auth(outsider.tokens.accessToken),
    });
    expect(hidden.statusCode).toBe(404);

    const calendar = await app.inject({
      method: 'GET',
      url: '/api/gathering/calendar?from=2020-01-01T00:00:00.000Z&to=2035-01-01T00:00:00.000Z',
      headers: auth(member.tokens.accessToken),
    });
    expect(calendar.json().items).toHaveLength(1);
    const outsiderCalendar = await app.inject({
      method: 'GET',
      url: '/api/gathering/calendar?from=2020-01-01T00:00:00.000Z&to=2035-01-01T00:00:00.000Z',
      headers: auth(outsider.tokens.accessToken),
    });
    expect(outsiderCalendar.json().items.some((item: { groupId: string }) => item.groupId === group.id)).toBe(false);
    expect(outsiderCalendar.json().items.some((item: { groupId: string }) => item.groupId === other.id)).toBe(true);

    const eventId = created.json().id as string;
    const attending = await app.inject({
      method: 'PUT',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/attendance`,
      headers: auth(member.tokens.accessToken),
      payload: { status: 'ATTENDING' },
    });
    expect(attending.json().myAttendance).toBe('ATTENDING');
    expect(attending.json().counts.attending).toBe(1);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}/events/${eventId}`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '월례모임 변경', place: '다른 방' },
    });
    expect(updated.statusCode).toBe(200);
    expect(sender.sent).toHaveLength(2);

    const cancelled = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}/events/${eventId}`,
      headers: auth(owner.tokens.accessToken),
      payload: { status: 'CANCELLED' },
    });
    expect(cancelled.json().status).toBe('CANCELLED');
    const blocked = await app.inject({
      method: 'PUT',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/attendance`,
      headers: auth(member.tokens.accessToken),
      payload: { status: 'DECLINED' },
    });
    expect(blocked.statusCode).toBe(409);
  });

  it('리마인드는 한 번만 보내고 만료 토큰은 끈다', async () => {
    const owner = await register('알림회장');
    const member = await register('알림회원');
    const group = await createGroup(owner.tokens.accessToken, '알림 모임');
    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: auth(member.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    const token = `ExponentPushToken[remind-${member.user.id}]`;
    await app.inject({
      method: 'POST',
      url: '/api/gathering/push/tokens',
      headers: auth(member.tokens.accessToken),
      payload: { permission: 'granted', platform: 'IOS', token },
    });
    const startsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '곧 시작', startsAt },
    });
    sender.sent.length = 0;
    sender.nextReason = 'DeviceNotRegistered';
    const first = await app.inject({
      method: 'POST',
      url: '/api/gathering/jobs/reminders',
      headers: { 'x-gathering-job-secret': currentJobSecret() },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/gathering/jobs/reminders',
      headers: { 'x-gathering-job-secret': currentJobSecret() },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const reminderSends = sender.sent.filter((message) => message.data.kind === 'EVENT_REMINDER');
    expect(reminderSends).toHaveLength(1);
    const stored = await prisma.gatheringPushToken.findUniqueOrThrow({ where: { token } });
    expect(stored.disabledAt).toBeTruthy();

    const missing = await app.inject({ method: 'POST', url: '/api/gathering/jobs/reminders' });
    expect(missing.statusCode).toBe(404);
  });

  it('알림 권한 거절은 토큰을 끈다', async () => {
    const owner = await register('권한알림');
    const token = `ExponentPushToken[deny-${owner.user.id}]`;
    await app.inject({
      method: 'POST',
      url: '/api/gathering/push/tokens',
      headers: auth(owner.tokens.accessToken),
      payload: { permission: 'granted', platform: 'ANDROID', token },
    });
    const denied = await app.inject({
      method: 'POST',
      url: '/api/gathering/push/tokens',
      headers: auth(owner.tokens.accessToken),
      payload: { permission: 'denied', platform: 'ANDROID', token },
    });
    expect(denied.statusCode).toBe(200);
    const stored = await prisma.gatheringPushToken.findUniqueOrThrow({ where: { token } });
    expect(stored.disabledAt).toBeTruthy();
  });

  it('회장 해임 이력이 집행부 목록에 남는다', async () => {
    const owner = await register('집행회장');
    const member = await register('집행총무');
    const group = await createGroup(owner.tokens.accessToken, '집행 모임');
    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: auth(member.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    const assigned = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/officers`,
      headers: auth(owner.tokens.accessToken),
      payload: { userId: member.user.id, role: 'SECRETARY' },
    });
    expect(assigned.statusCode).toBe(200);
    const memberAttempt = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/officers`,
      headers: auth(member.tokens.accessToken),
      payload: { userId: owner.user.id, role: 'TREASURER' },
    });
    expect(memberAttempt.statusCode).toBe(403);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/officers/${assigned.json().assignmentId}/revoke`,
      headers: auth(owner.tokens.accessToken),
    });
    const officers = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/officers`,
      headers: auth(member.tokens.accessToken),
    });
    expect(officers.json().current.some((row: { role: string }) => row.role === 'SECRETARY')).toBe(false);
    expect(officers.json().history.some((row: { role: string; endedAt: string | null }) => row.role === 'SECRETARY' && row.endedAt)).toBe(true);
  });
});

describe('저장소 준비', () => {
  it('설정이 없으면 업로드 URL을 만들지 않고 키 규칙만 지킨다', async () => {
    expect(buildGatheringObjectKey({ groupId: 'group1', kind: 'receipt', objectId: 'file1' })).toBe(
      'gathering/group1/receipt/file1',
    );
    await expect(
      createGatheringUploadTarget({ groupId: 'group1', kind: 'media', objectId: 'file1' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

async function cleanup() {
  if (groupIds.length > 0) {
    await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringEventAttendance.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringEvent.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringInvite.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  }
  if (userIds.length === 0) return;
  await prisma.gatheringPushToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
