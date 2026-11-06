/**
 * 새 모임의 이용 기간.
 * 기존 모임 행에는 소급하지 않는다. 호출하는 쪽이 새 INSERT 에서만 연다.
 * 저장 용량 한도는 storage-policy 에 따로 있다. 기간이 살아 있어도 한도를 넘기면 업로드는 거절된다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const TRIAL_DAYS = 30;

/** 앞으로의 정식 연회비. 예전 3만 원 상수와 기존 입금 이력은 바꾸지 않는다. */
export const FORMAL_ANNUAL_FEE_WON = 60_000;

export type EntitlementAction = 'READ' | 'ACCOUNT' | 'WRITE';

export type EntitlementDenial = 'SUSPENDED' | 'ENTITLEMENT_REQUIRED';

export function trialWindow(now: Date) {
  return { startsAt: new Date(now.getTime()), expiresAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS) };
}

/**
 * 즉시 승인은 남은 기간을 보존한다. 기준은 max(지금, 현재 만료) 이고 거기에 1년을 더한다.
 * 미래 시작은 그 시작 시각부터 1년이다. 정지는 이 계산으로 풀리지 않는다.
 */
export function formalTermExpiry(approvedAt: Date, currentExpiresAt: Date | null, now: Date) {
  const anchor =
    approvedAt.getTime() > now.getTime()
      ? approvedAt
      : currentExpiresAt && currentExpiresAt.getTime() > now.getTime()
        ? currentExpiresAt
        : approvedAt;
  const expires = new Date(anchor.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
}

/**
 * 이 모임 행에 체험 기록이 있으면 다시 열지 않는다.
 * 다른 모임은 막지 않는다. 이름이나 휴대폰으로 같은 모임인지 추정하지 않는다.
 */
export function canOpenTrial(groupAlreadyHasTrial: boolean) {
  return !groupAlreadyHasTrial;
}

/**
 * 읽기와 계정·초대 조회는 기간과 정지에 막히지 않는다.
 * 새 행사, 장부, 사진·영상·영수증 업로드는 WRITE 다.
 */
export function evaluateEntitlement(input: {
  suspended: boolean;
  covered: boolean;
  action: EntitlementAction;
}): { allowed: true } | { allowed: false; reason: EntitlementDenial } {
  if (input.action === 'READ' || input.action === 'ACCOUNT') return { allowed: true };
  if (input.suspended) return { allowed: false, reason: 'SUSPENDED' };
  if (!input.covered) return { allowed: false, reason: 'ENTITLEMENT_REQUIRED' };
  return { allowed: true };
}
