import type { GatheringLocalAffiliation, GatheringProfile, User } from '@prisma/client';
import type { GatheringAuthProfile, GatheringAuthUser } from '@member/contracts';
import { IDENTITY_LIMITATION_KO } from '@member/gathering-domain';

export type AccountRecord = User & {
  gatheringProfile: GatheringProfile | null;
  gatheringAffiliations: GatheringLocalAffiliation[];
};

type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export function toAuthUser(user: User): GatheringAuthUser {
  return { id: user.id, phone: user.phone, status: user.status };
}

export function toAuthProfile(user: AccountRecord): GatheringAuthProfile | null {
  if (!user.gatheringProfile) return null;
  return {
    displayName: user.gatheringProfile.displayName,
    localJcName: user.gatheringAffiliations[0]?.localJcName ?? '',
    directoryConsentAt: user.gatheringProfile.directoryConsentAt.toISOString(),
  };
}

export function sessionBody(user: AccountRecord, tokens: IssuedTokens, recoveryCodes?: string[]) {
  return {
    tokens,
    user: toAuthUser(user),
    profile: toAuthProfile(user),
    identityLimitation: IDENTITY_LIMITATION_KO,
    ...(recoveryCodes ? { recoveryCodes } : {}),
  };
}
