import { describe, expect, it } from 'vitest';
import {
  ADMIN_LOCK_THRESHOLD,
  adminAllows,
  adminLockUntil,
  adminLoginBlocked,
  canManageAdminAccounts,
} from './admin-access.js';

const now = new Date('2026-11-06T06:00:00.000Z');

describe('관리자 권한', () => {
  it('슈퍼관리자는 모임을 가리지 않고, 담당 관리자는 부여된 모임만 본다', () => {
    expect(
      adminAllows({ role: 'SUPER_ADMIN', disabled: false, scopes: [], capability: 'GROUP_READ', groupId: 'b' }),
    ).toBe(true);
    const scopes = [{ groupId: 'a', capability: 'GROUP_READ' }];
    expect(adminAllows({ role: 'ADMIN', disabled: false, scopes, capability: 'GROUP_READ', groupId: 'a' })).toBe(true);
    expect(adminAllows({ role: 'ADMIN', disabled: false, scopes, capability: 'GROUP_READ', groupId: 'b' })).toBe(false);
    expect(adminAllows({ role: 'ADMIN', disabled: true, scopes, capability: 'GROUP_READ', groupId: 'a' })).toBe(false);
    expect(canManageAdminAccounts('ADMIN', false)).toBe(false);
    expect(canManageAdminAccounts('SUPER_ADMIN', false)).toBe(true);
  });

  it('비밀번호 실패가 기준을 넘으면 잠그고, 시간이 지나면 푼다', () => {
    expect(adminLockUntil(ADMIN_LOCK_THRESHOLD - 1, now)).toBeNull();
    const until = adminLockUntil(ADMIN_LOCK_THRESHOLD, now);
    expect(until).not.toBeNull();
    expect(adminLoginBlocked(until, now)).toBe(true);
    expect(adminLoginBlocked(until, new Date(until!.getTime() + 1))).toBe(false);
  });
});
