export type PendingInviteOutcome =
  | 'preview-failed'
  | 'accept-failed'
  | 'dismissed'
  | 'profile-required'
  | 'accepted';

/** 프로필이 없어 잠시 벗어난 경우만 초대 토큰을 유지한다. */
export function shouldKeepPendingInvite(outcome: PendingInviteOutcome) {
  return outcome === 'profile-required';
}
