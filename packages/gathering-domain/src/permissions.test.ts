import { describe, expect, it } from 'vitest';
import { hasPermission, permissionsForRoles } from './permissions.js';

describe('모임 권한', () => {
  it('회장만 역할 지정, 모임 설정, 인계 권한을 가진다', () => {
    expect(hasPermission(['PRESIDENT'], 'ROLE_ASSIGN')).toBe(true);
    expect(hasPermission(['PRESIDENT'], 'GROUP_SETTINGS')).toBe(true);
    expect(hasPermission(['PRESIDENT'], 'HANDOVER')).toBe(true);
    expect(hasPermission(['SECRETARY'], 'ROLE_ASSIGN')).toBe(false);
    expect(hasPermission(['TREASURER'], 'GROUP_SETTINGS')).toBe(false);
    expect(hasPermission(['MEMBER'], 'FINANCE_WRITE')).toBe(false);
  });

  it('총무는 회원·행사·초대를 맡고 장부 수정은 하지 못한다', () => {
    expect(hasPermission(['SECRETARY'], 'MEMBER_MANAGE')).toBe(true);
    expect(hasPermission(['SECRETARY'], 'EVENT_MANAGE')).toBe(true);
    expect(hasPermission(['SECRETARY'], 'INVITE_MANAGE')).toBe(true);
    expect(hasPermission(['SECRETARY'], 'FINANCE_WRITE')).toBe(false);
    expect(hasPermission(['SECRETARY'], 'RECEIPT_WRITE')).toBe(false);
  });

  it('재무는 장부와 영수증을 수정하고 회원 승인은 하지 못한다', () => {
    expect(hasPermission(['TREASURER'], 'FINANCE_WRITE')).toBe(true);
    expect(hasPermission(['TREASURER'], 'RECEIPT_WRITE')).toBe(true);
    expect(hasPermission(['TREASURER'], 'MEMBER_MANAGE')).toBe(false);
  });

  it('일반 회원과 추가 집행부는 조회와 미디어 업로드만 한다', () => {
    for (const role of ['MEMBER', 'EXECUTIVE'] as const) {
      expect(hasPermission([role], 'FINANCE_READ')).toBe(true);
      expect(hasPermission([role], 'MEDIA_UPLOAD')).toBe(true);
      expect(hasPermission([role], 'MEDIA_MODERATE')).toBe(false);
      expect(hasPermission([role], 'EVENT_MANAGE')).toBe(false);
    }
  });

  it('한 사람이 총무와 재무를 겸하면 두 역할의 권한을 합친다', () => {
    const permissions = permissionsForRoles(['SECRETARY', 'TREASURER']);
    expect(permissions).toContain('MEMBER_MANAGE');
    expect(permissions).toContain('FINANCE_WRITE');
    expect(permissions).not.toContain('ROLE_ASSIGN');
  });
});
