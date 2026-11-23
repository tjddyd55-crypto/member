import type { GatheringAffiliationView } from '@member/contracts';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import {
  affiliationLocalSelect,
  confirmedActive,
  displayName,
  districtRef,
  matchLocal,
} from './directory.js';

export type AffiliationInput = { localId?: string; localJcName?: string };
export type AffiliationLocal = Prisma.LocalGetPayload<{ select: typeof affiliationLocalSelect }>;
export type AffiliationRecord = { localJcName: string; local?: AffiliationLocal | null };

export const currentAffiliation = {
  where: { isCurrent: true },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: 1,
  include: { local: { select: affiliationLocalSelect } },
} satisfies Prisma.UserInclude['gatheringAffiliations'];

export async function resolveAffiliation(db: Prisma.TransactionClient, input: AffiliationInput) {
  if (input.localId) {
    const local = await db.local.findUnique({
      where: { id: input.localId, ...confirmedActive },
      select: affiliationLocalSelect,
    });
    if (!local) {
      throw new AppError(400, 'JC_LOCAL_INVALID', '소속 로컬JC를 다시 선택해 주세요.');
    }
    return { localId: local.id, localJcName: displayName(local) };
  }
  if (!input.localJcName) {
    throw new AppError(400, 'JC_LOCAL_INVALID', '소속 로컬JC를 선택해 주세요.');
  }
  const local = await matchLocal(db, input.localJcName);
  return { localId: local?.id ?? null, localJcName: input.localJcName };
}

export function affiliationView(
  localJcName: string,
  local?: AffiliationLocal | null,
): GatheringAffiliationView {
  return {
    localJcName,
    localId: local?.id ?? null,
    district: local ? districtRef(local.district) : null,
    localDisplayName: local ? displayName(local) : localJcName,
    affiliationNeedsReselect: !local || !local.isActive || local.verificationState !== 'CONFIRMED',
  };
}
