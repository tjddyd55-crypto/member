import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ANNUAL_GROUP_FEE_WON } from '@member/gathering-domain';
import { totpAt } from '../../api/src/modules/gathering/admin/totp.ts';

config({ path: join(import.meta.dirname, '../../../.env') });

const API = 'http://127.0.0.1:3001';
const prisma = new PrismaClient();
const password = 'BrowserAdmin1!';
const nextPassword = 'BrowserAdmin2!';
const userIds: string[] = [];
const groupIds: string[] = [];
const adminIds: string[] = [];

test.afterAll(async () => {
  if (adminIds.length > 0) {
    await prisma.gatheringAdminAudit.deleteMany({ where: { OR: [{ actorAdminId: { in: adminIds } }, { targetId: { in: adminIds } }] } });
    await prisma.gatheringAdminOperation.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringDeposit.updateMany({ where: { confirmedByAdminId: { in: adminIds } }, data: { confirmedByAdminId: null } });
    await prisma.gatheringSubscription.updateMany({ where: { approvedByAdminId: { in: adminIds } }, data: { approvedByAdminId: null } });
    await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminEnrollment.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: adminIds } } });
  }
  if (groupIds.length > 0) {
    await prisma.gatheringDepositLink.deleteMany({ where: { deposit: { groupId: { in: groupIds } } } });
    await prisma.gatheringDeposit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMemberDue.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringUploadLink.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaFolder.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
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
  if (userIds.length > 0) {
    await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
});

test('관리 화면은 PC와 좁은 화면에서 같은 운영 흐름을 수행한다', async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const loginId = `browser.${stamp}`.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  const phone = `010${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const groupName = `브라우저 ${stamp}`;
  const secretBox = { secret: '' };
  page.on('response', async (response) => {
    if (!response.url().includes('/api/gathering-admin/auth/totp/start') || !response.ok()) return;
    const body = (await response.json()) as { secret?: string };
    if (body.secret) secretBox.secret = body.secret;
  });

  const owner = await register(phone, '브라우저회장');
  const successor = await register(`010${String(Math.floor(10000000 + Math.random() * 89999999))}`, '브라우저차기');
  const group = await api<{ id: string; financeYear: { year: number } }>('/api/gathering/groups', owner.token, {
    name: groupName,
  });
  groupIds.push(group.id);
  const invite = await api<{ token: string }>(`/api/gathering/groups/${group.id}/invites`, owner.token, {});
  await api(`/api/gathering/invites/${invite.token}/accept`, successor.token, { directoryConsent: true });
  const instant = new Date().toISOString();
  const event = await api<{ id: string }>(`/api/gathering/groups/${group.id}/events`, owner.token, {
    title: '브라우저 행사',
    startsAt: instant,
  });
  await api(`/api/gathering/groups/${group.id}/finance/dues`, owner.token, {
    userId: successor.userId,
    year: group.financeYear.year,
    amountWon: ANNUAL_GROUP_FEE_WON,
    paidAmountWon: 0,
  });
  const handover = await api<{ id: string }>(`/api/gathering/groups/${group.id}/handover`, owner.token, {
    toUserId: successor.userId,
    idempotencyKey: `browser-hand-${stamp}`,
  });
  const link = await api<{ token: string }>(`/api/gathering/groups/${group.id}/upload-links`, owner.token, {
    eventId: event.id,
  });
  const trial = await prisma.gatheringSubscription.findFirstOrThrow({ where: { groupId: group.id, source: 'TRIAL' } });
  expect(trial.expiresAt.getTime() - trial.startsAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);

  const admin = await prisma.gatheringAdminAccount.create({
    data: { loginId, passwordHash: await bcrypt.hash(password, 4), role: 'SUPER_ADMIN' },
  });
  adminIds.push(admin.id);
  const other = await prisma.gatheringAdminAccount.create({
    data: { loginId: `${loginId}.other`.slice(0, 64), passwordHash: await bcrypt.hash(password, 4), role: 'SUPER_ADMIN' },
  });
  adminIds.push(other.id);

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'JCI KOREA 관리' })).toBeVisible();
  await page.getByLabel('아이디').fill(loginId);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('heading', { name: '인증 앱 등록' })).toBeVisible();
  await expect.poll(() => secretBox.secret.length).toBeGreaterThan(10);
  await page.getByLabel('6자리 코드').fill(totpAt(secretBox.secret, Date.now()));
  await page.getByRole('button', { name: '등록하고 로그인' }).click();
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'gathering_admin_session');
  expect(session?.value).toBeTruthy();

  await page.getByRole('link', { name: '모임' }).click();
  const row = page.getByRole('row', { name: groupName });
  await expect(row).toContainText('TRIAL');
  await expect(row).toContainText('50000000000');
  await expect(row.locator(`[data-expiry="${trial.expiresAt.toISOString()}"]`)).toBeVisible();
  await page.getByRole('link', { name: groupName }).click();
  await page.getByRole('button', { name: '생성자/회장' }).click();
  await expect(page.getByRole('link', { name: '전화' }).first()).toHaveAttribute('href', `tel:${phone}`);
  await expect(page.getByRole('link', { name: '문자' }).first()).toHaveAttribute('href', `sms:${phone}`);
  await expect(page.getByRole('button', { name: '복사' }).first()).toBeVisible();

  await page.getByRole('button', { name: '이용권' }).click();
  await expect(page.getByText(`현재 이용권 ${trial.id}`)).toBeVisible();
  await page.getByLabel('사유').fill('정식 1년');
  await page.getByRole('button', { name: '승인 또는 연장' }).click();
  await expect(page.getByText('서버가 반영했습니다.')).toBeVisible();
  await expect(page.locator('[data-source="PAID"]')).toBeVisible();

  await page.getByRole('button', { name: '용량' }).click();
  await page.getByLabel('할당 바이트').fill('100000000000');
  await page.getByLabel('사유').fill('100GB');
  await page.getByRole('button', { name: '용량 변경' }).click();
  await expect(page.locator('[data-quota="100000000000"]')).toBeVisible();
  const photo = join(tmpdir(), `gathering-${stamp}.jpg`);
  mkdirSync(tmpdir(), { recursive: true });
  const jpeg = Buffer.alloc(32, 1);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  writeFileSync(photo, jpeg);
  await page.goto(`${API}/api/gathering/public/uploads/${link.token}`);
  await page.locator('#files').setInputFiles(photo);
  await page.locator('#go').click();
  await expect(page.locator('#log')).toContainText('올렸습니다');
  const uploaded = await prisma.gatheringMediaAsset.count({ where: { groupId: group.id, status: 'READY', deletedAt: null } });
  expect(uploaded).toBe(1);

  await page.goto(`/groups/${group.id}`);
  await page.getByRole('button', { name: '용량' }).click();
  await page.getByLabel('할당 바이트').fill('1000');
  await page.getByLabel('사유').fill('축소');
  await page.getByRole('button', { name: '용량 변경' }).click();
  await expect(page.locator('[data-quota="1000"]')).toBeVisible();
  expect(await prisma.gatheringMediaAsset.count({ where: { groupId: group.id, status: 'READY', deletedAt: null } })).toBe(1);

  await page.getByRole('button', { name: '입금' }).click();
  await page.getByLabel('입금자').fill('테스트');
  await page.getByRole('textbox', { name: '금액', exact: true }).fill('1000');
  await page.getByLabel('입금일').fill('2026-11-06T09:00');
  await page.getByRole('button', { name: '입금 기록' }).click();
  await expect(page.getByText(/기록 /)).toBeVisible();
  await page.getByRole('button', { name: '확인 후 연결' }).click();
  await expect(page.getByText('금액이 정식 연회비와 다릅니다')).toBeVisible();

  await page.getByRole('button', { name: '이용권' }).click();
  await page.getByLabel('구분').selectOption('COMPLIMENTARY');
  await page.getByLabel('사유').fill('무상');
  await page.getByRole('button', { name: '승인 또는 연장' }).click();
  await expect(page.locator('[data-source="COMPLIMENTARY"]')).toBeVisible();

  await page.getByRole('button', { name: '모임 정지' }).click();
  await expect(page.locator('[data-suspended="1"]')).toBeVisible();
  const blocked = await fetch(`${API}/api/gathering/groups/${group.id}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: '정지 중', startsAt: new Date().toISOString() }),
  });
  expect(blocked.status).toBe(409);
  expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('SUSPENDED');
  const media = await prisma.gatheringMediaAsset.findFirstOrThrow({ where: { groupId: group.id, status: 'READY' } });
  const download = await fetch(`${API}/api/gathering/groups/${group.id}/media/${media.id}/download`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  expect(download.status).toBe(200);
  await page.goto(`${API}/api/gathering/public/uploads/${link.token}`);
  await page.locator('#files').setInputFiles(photo);
  await page.locator('#go').click();
  await expect(page.locator('#log')).toContainText('정지되어');

  await page.goto(`/groups/${group.id}`);
  await page.getByRole('button', { name: '이용권' }).click();
  await page.getByRole('button', { name: '정지 해제' }).click();
  await expect(page.locator('[data-suspended="0"]')).toBeVisible();
  const resumed = await fetch(`${API}/api/gathering/groups/${group.id}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: '해제 후', startsAt: new Date().toISOString() }),
  });
  expect(resumed.status).toBe(200);

  await prisma.gatheringSubscription.updateMany({
    where: { groupId: group.id, status: 'ACTIVE' },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const expired = await fetch(`${API}/api/gathering/groups/${group.id}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: '만료 중', startsAt: new Date().toISOString() }),
  });
  expect(expired.status).toBe(409);
  expect(((await expired.json()) as { error: { code: string } }).error.code).toBe('ENTITLEMENT_REQUIRED');
  const still = await fetch(`${API}/api/gathering/groups/${group.id}/media/${media.id}/download`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  expect(still.status).toBe(200);
  await prisma.gatheringSubscription.updateMany({
    where: { groupId: group.id, source: 'COMPLIMENTARY' },
    data: { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), status: 'ACTIVE' },
  });

  await page.goto('/audits');
  await expect(page.getByRole('heading', { name: '운영이력' })).toBeVisible();
  await expect(page.getByText('ADMIN_SUBSCRIPTION_APPROVE').first()).toBeVisible();

  await page.goto(`/groups/${group.id}`);
  await page.getByRole('button', { name: '회원' }).click();
  await page.locator('tr', { hasText: '브라우저회장' }).getByRole('button', { name: '제한' }).click();
  await expect(page.getByText('SUSPENDED').first()).toBeVisible();
  const own = await fetch(`${API}/api/gathering/groups/${group.id}`, { headers: { authorization: `Bearer ${owner.token}` } });
  expect(own.status).toBe(403);
  const kept = await prisma.gatheringGroup.findUniqueOrThrow({ where: { id: group.id } });
  expect(kept.createdByUserId).toBe(owner.userId);
  const hand = await prisma.gatheringHandover.findUniqueOrThrow({ where: { id: handover.id } });
  expect(hand.status).toBe('NOMINATED');
  const due = await prisma.gatheringMemberDue.findFirstOrThrow({ where: { groupId: group.id } });
  expect(due.amountWon).toBe(30_000);
  await page.getByRole('button', { name: '생성자/회장' }).click();
  await expect(page.getByRole('heading', { name: '최초 생성자' })).toBeVisible();
  await expect(page.getByText('브라우저회장').first()).toBeVisible();

  await page.getByRole('link', { name: '관리자' }).click();
  await expect(page.getByRole('checkbox', { name: '연락처' })).toBeVisible();
  await page.locator('tr', { hasText: other.loginId }).getByRole('button', { name: '비활성' }).click();
  await expect(page.locator('tr', { hasText: other.loginId })).toContainText('비활성');

  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('heading', { name: 'JCI KOREA 관리' })).toBeVisible();
  await page.getByLabel('아이디').fill(loginId);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByLabel('인증 코드').fill(totpAt(secretBox.secret, Date.now()));
  await page.getByRole('button', { name: '로그인' }).click();
  await page.getByRole('link', { name: '내 계정' }).click();
  await page.getByLabel('현재').fill(password);
  await page.getByLabel('새 비밀번호').fill(nextPassword);
  await page.getByRole('button', { name: '변경 후 다시 로그인' }).click();
  await expect(page.getByRole('heading', { name: 'JCI KOREA 관리' })).toBeVisible();
  const revoked = await fetch(`${API}/api/gathering-admin/me`, {
    headers: { cookie: `gathering_admin_session=${session?.value ?? ''}` },
  });
  expect(revoked.status).toBe(401);
  const memberToken = await fetch(`${API}/api/gathering-admin/me`, {
    headers: { authorization: `Bearer ${owner.token}` },
  });
  expect(memberToken.status).toBe(401);
});

async function register(phone: string, name: string) {
  const response = await fetch(`${API}/api/gathering/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, phone, password: 'Passw0rd!', localJcName: '서울테스트', directoryConsent: true }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string }; user: { id: string } };
  userIds.push(body.user.id);
  return { token: body.tokens.accessToken, userId: body.user.id };
}

async function api<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status, path).toBe(200);
  return (await response.json()) as T;
}
