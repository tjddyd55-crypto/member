import type { GatheringEvent } from '@prisma/client';
import { notificationDedupeKey, REMINDER_WINDOW_MS, type NoticeKind } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { ExpoPushSender, type PushSender } from './sender.js';

let sender: PushSender = new ExpoPushSender();

export function usePushSender(next: PushSender) {
  sender = next;
}

export async function registerGatheringPush(
  userId: string,
  input: { permission: 'granted' | 'denied'; platform: 'IOS' | 'ANDROID'; token?: string },
) {
  if (input.permission === 'denied') {
    await disablePushTokens(userId, input.token);
    return { ok: true as const };
  }
  if (!input.token) throw new AppError(400, 'PUSH_TOKEN_REQUIRED', '알림 토큰이 필요합니다.');
  const now = new Date();
  await prisma.gatheringPushToken.upsert({
    where: { token: input.token },
    create: { userId, token: input.token, platform: input.platform, lastSeenAt: now },
    update: { userId, platform: input.platform, disabledAt: null, lastSeenAt: now },
  });
  return { ok: true as const };
}

async function disablePushTokens(userId: string, token?: string) {
  await prisma.gatheringPushToken.updateMany({
    where: token ? { userId, token } : { userId, disabledAt: null },
    data: { disabledAt: new Date() },
  });
}

export async function notifyGatheringEvent(event: GatheringEvent, kind: NoticeKind, actorUserId: string) {
  const group = await prisma.gatheringGroup.findUnique({ where: { id: event.groupId } });
  const members = await prisma.gatheringMembership.findMany({
    where: {
      groupId: event.groupId,
      status: 'ACTIVE',
      ...(kind === 'EVENT_REMINDER' ? {} : { userId: { not: actorUserId } }),
    },
    select: { userId: true },
  });
  const version = noticeVersion(event, kind);
  for (const member of members) {
    await notifyMember(event, group?.name ?? '모임', kind, member.userId, version);
  }
  return members.length;
}

function noticeVersion(event: GatheringEvent, kind: NoticeKind) {
  if (kind === 'EVENT_CREATED') return '1';
  if (kind === 'EVENT_REMINDER') return event.startsAt.toISOString();
  return event.updatedAt.toISOString();
}

async function notifyMember(
  event: GatheringEvent,
  groupName: string,
  kind: NoticeKind,
  userId: string,
  version: string,
) {
  const dedupeKey = notificationDedupeKey({ kind, eventId: event.id, userId, version });
  const created = await createNotice(event, userId, kind, dedupeKey);
  if (!created) return;
  const tokens = await prisma.gatheringPushToken.findMany({
    where: { userId, disabledAt: null },
    select: { token: true },
  });
  if (tokens.length === 0) {
    await markNotice(created.id, 'SKIPPED');
    return;
  }
  await deliver(created.id, tokens.map((row) => row.token), {
    title: 'JCI KOREA',
    body: noticeBody(groupName, event.title, kind),
    data: { groupId: event.groupId, eventId: event.id, kind },
  });
}

async function createNotice(event: GatheringEvent, userId: string, kind: NoticeKind, dedupeKey: string) {
  try {
    return await prisma.gatheringNotification.create({
      data: {
        userId,
        groupId: event.groupId,
        type: kind,
        dedupeKey,
        payloadJson: JSON.stringify({ eventId: event.id, title: event.title }),
      },
    });
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

async function deliver(
  noticeId: string,
  tokens: string[],
  message: { title: string; body: string; data: Record<string, string> },
) {
  try {
    const tickets = await sender.send(tokens.map((token) => ({ to: token, ...message })));
    await disableExpiredTokens(tickets);
    const failed = tickets.some((ticket) => ticket.status === 'error');
    await markNotice(noticeId, failed ? 'FAILED' : 'SENT');
  } catch {
    await markNotice(noticeId, 'FAILED');
  }
}

async function disableExpiredTokens(tickets: Awaited<ReturnType<PushSender['send']>>) {
  const expired = tickets
    .filter((ticket) => ticket.status === 'error' && ticket.reason === 'DeviceNotRegistered')
    .map((ticket) => ticket.token);
  if (expired.length === 0) return;
  await prisma.gatheringPushToken.updateMany({
    where: { token: { in: expired } },
    data: { disabledAt: new Date() },
  });
}

async function markNotice(id: string, status: 'SENT' | 'FAILED' | 'SKIPPED') {
  await prisma.gatheringNotification.update({
    where: { id },
    data: { status, sentAt: status === 'SENT' ? new Date() : null },
  });
}

function noticeBody(groupName: string, title: string, kind: NoticeKind) {
  if (kind === 'EVENT_CREATED') return `${groupName} 행사 등록: ${title}`;
  if (kind === 'EVENT_UPDATED') return `${groupName} 행사 변경: ${title}`;
  return `${groupName} 1시간 전 행사: ${title}`;
}

function isUnique(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function dispatchEventReminders(now = new Date()) {
  const until = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const events = await prisma.gatheringEvent.findMany({
    where: { status: 'SCHEDULED', deletedAt: null, startsAt: { gte: now, lte: until } },
  });
  for (const event of events) {
    await notifyGatheringEvent(event, 'EVENT_REMINDER', event.createdByUserId);
  }
  return events.length;
}
