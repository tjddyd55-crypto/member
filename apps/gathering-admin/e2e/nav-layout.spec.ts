import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

config({ path: join(import.meta.dirname, '../../../.env') });

const API = 'http://127.0.0.1:3001';
const prisma = new PrismaClient();
const password = 'LayoutAdmin1!';
const userIds: string[] = [];
const groupIds: string[] = [];
const adminIds: string[] = [];

test.afterAll(async () => {
  if (adminIds.length > 0) {
    await prisma.gatheringAdminAudit.deleteMany({ where: { OR: [{ actorAdminId: { in: adminIds } }, { targetId: { in: adminIds } }] } });
    await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: adminIds } } });
  }
  if (groupIds.length > 0) {
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
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

test('관리 메뉴는 좁은 화면에서 한 줄이고, PC에서는 옆 메뉴다', async ({ page }) => {
  const stamp = Date.now();
  const loginId = `virtual.layout.${stamp}`;
  const phone = `010${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const owner = await register(phone, '가상테스트회원');
  const group = await api<{ id: string }>('/api/gathering/groups', owner.token, { name: '가상테스트모임' });
  groupIds.push(group.id);
  const admin = await prisma.gatheringAdminAccount.create({
    data: { loginId, passwordHash: await bcrypt.hash(password, 4), role: 'SUPER_ADMIN' },
  });
  adminIds.push(admin.id);

  mkdirSync('/tmp/gathering-nav-shots', { recursive: true });
  await page.setViewportSize({ width: 390, height: 985 });
  await login(page, loginId);
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '관리 메뉴' })).toBeVisible();
  await expectMenuRow(page, 390);
  await expect(page.getByText(loginId)).toBeVisible();
  await page.screenshot({ path: '/tmp/gathering-nav-shots/mobile_390_menu.png' });
  await scrollMenuToEnd(page);
  await page.getByRole('link', { name: '내 계정' }).click();
  await expect(page.getByRole('heading', { name: '비밀번호' })).toBeVisible();
  await page.screenshot({ path: '/tmp/gathering-nav-shots/mobile_390_scrolled.png' });

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expectMenuRow(page, 360);

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expectMenuRow(page, 768);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/groups/${group.id}`);
  await expect(page.getByRole('heading', { name: '가상테스트모임' })).toBeVisible();
  await expectSideMenu(page);
  const tabs = page.locator('.tabs button');
  await expect(tabs).toHaveCount(7);
  const tabBoxes = await tabs.evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { name: node.textContent ?? '', width: box.width, height: box.height };
  }));
  for (const tab of tabBoxes) {
    expect(tab.height, tab.name).toBeLessThan(56);
    expect(tab.width, tab.name).toBeGreaterThan(tab.height);
  }
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/gathering-nav-shots/pc_1280_sidebar.png' });

  await page.setViewportSize({ width: 390, height: 985 });
  await page.goto(`/groups/${group.id}`);
  await expectMenuRow(page, 390);
  await expect(tabs).toHaveCount(7);
  const narrowTabs = await tabs.evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { name: node.textContent ?? '', width: box.width, height: box.height };
  }));
  for (const tab of narrowTabs) {
    expect(tab.height, tab.name).toBeLessThan(56);
    expect(tab.width, tab.name).toBeGreaterThan(tab.height);
  }
  await page.locator('.tabs').evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await page.getByRole('button', { name: '감사', exact: true }).click();
  await expectNoPageOverflow(page);
  await page.screenshot({ path: '/tmp/gathering-nav-shots/mobile_390_tabs.png' });
});

async function login(page: Page, loginId: string) {
  await page.goto('/login');
  await page.getByLabel('아이디').fill(loginId);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
}

async function expectMenuRow(page: Page, width: number) {
  const nav = page.getByRole('navigation', { name: '관리 메뉴' });
  await expect(nav.getByRole('link', { name: '대시보드' })).toBeVisible();
  await expect(nav.getByRole('button', { name: '로그아웃' })).toBeVisible();
  const items = await menuBoxes(page);
  expect(items.map((item) => item.name)).toEqual(['대시보드', '모임', '회원', '운영이력', '시스템설정', '관리자', '내 계정', '로그아웃']);
  const first = items[0];
  if (!first) throw new Error('메뉴가 없습니다.');
  for (const item of items) {
    expect(item.height, item.name).toBeLessThan(56);
    expect(item.width, item.name).toBeGreaterThan(item.height);
    expect(Math.abs(item.y - first.y), item.name).toBeLessThan(8);
  }
  if (width <= 430) {
    const scrolled = await nav.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(scrolled.scrollWidth).toBeGreaterThan(scrolled.clientWidth + 24);
  }
  await expectNoPageOverflow(page);
}

async function expectSideMenu(page: Page) {
  const nav = page.getByRole('navigation', { name: '관리 메뉴' });
  await expect(nav.getByRole('link', { name: '대시보드' })).toBeVisible();
  await expect(nav.getByRole('button', { name: '로그아웃' })).toBeVisible();
  const items = await menuBoxes(page);
  const first = items[0];
  const second = items[1];
  if (!first || !second) throw new Error('메뉴가 없습니다.');
  expect(second.y).toBeGreaterThan(first.y + 20);
  expect(Math.abs(second.x - first.x)).toBeLessThan(4);
  const navWidth = await nav.evaluate((node) => node.getBoundingClientRect().width);
  expect(navWidth).toBeGreaterThan(200);
  expect(navWidth).toBeLessThan(240);
}

async function scrollMenuToEnd(page: Page) {
  await page.getByRole('navigation', { name: '관리 메뉴' }).evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  const link = page.getByRole('link', { name: '내 계정' });
  await expect(link).toBeInViewport();
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function menuBoxes(page: Page) {
  return page.locator('nav a, nav button').evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { name: (node.textContent ?? '').trim(), x: box.x, y: box.y, width: box.width, height: box.height };
  }));
}

async function register(phone: string, name: string) {
  const response = await fetch(`${API}/api/gathering/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, phone, password: 'Passw0rd!', localJcName: '가상로컬', directoryConsent: true }),
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
