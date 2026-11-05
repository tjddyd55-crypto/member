import { describe, expect, it } from 'vitest';
import { shouldKeepPendingInvite } from './invite-retention.js';

describe('초대 토큰 보관', () => {
  it('만료·폐기·거절·취소 뒤에는 보관하지 않는다', () => {
    expect(shouldKeepPendingInvite('preview-failed')).toBe(false);
    expect(shouldKeepPendingInvite('accept-failed')).toBe(false);
    expect(shouldKeepPendingInvite('dismissed')).toBe(false);
    expect(shouldKeepPendingInvite('accepted')).toBe(false);
  });

  it('프로필 작성 뒤에 돌아오려면 토큰을 유지한다', () => {
    expect(shouldKeepPendingInvite('profile-required')).toBe(true);
  });
});
