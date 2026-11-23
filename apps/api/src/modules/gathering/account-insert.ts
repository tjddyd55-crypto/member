import { resolveAffiliation, type AffiliationInput } from '../jc-org/affiliation.js';
import type { GatheringSex, Prisma } from '@prisma/client';
import { parseBirthDate } from '@member/gathering-domain';
import { hashPassword } from '../../services/auth-service.js';
import { prisma } from '../../lib/prisma.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction, RECOVERY_CODE_COUNT } from './constants.js';
import { createRecoveryCode, sha256 } from './crypto.js';
import { issueGatheringSession } from './sessions.js';

type NewAccount = AffiliationInput & {
  phone: string;
  passwordHash: string;
  name: string;
  birthDate: string;
  sex: GatheringSex;
  userAgent?: string;
};

export async function insertGatheringAccount(tx: Prisma.TransactionClient, input: NewAccount) {
  const now = new Date();
  const user = await tx.user.create({
    data: {
      phone: input.phone,
      passwordHash: input.passwordHash,
      status: 'ACTIVE',
      lastLoginAt: now,
    },
  });
  const codes = await attachProfile(tx, {
    userId: user.id,
    name: input.name,
    localId: input.localId,
    localJcName: input.localJcName,
    birthDate: input.birthDate,
    sex: input.sex,
    now,
  });
  await writeGatheringAudit(tx, {
    actorUserId: user.id,
    action: GatheringAuditAction.REGISTER,
    targetType: 'User',
    targetId: user.id,
  });
  const tokens = await issueGatheringSession(tx, user.id, input.userAgent);
  return { userId: user.id, tokens, recoveryCodes: codes };
}

export async function attachProfile(
  tx: Prisma.TransactionClient,
  input: AffiliationInput & {
    userId: string;
    name: string;
    birthDate: string;
    sex: GatheringSex;
    now: Date;
  },
) {
  const birthDate = parseBirthDate(input.birthDate);
  const affiliation = await resolveAffiliation(tx, input);
  await tx.gatheringProfile.create({
    data: {
      userId: input.userId,
      displayName: input.name,
      birthDate,
      sex: input.sex,
      directoryConsentAt: input.now,
    },
  });
  await tx.gatheringLocalAffiliation.create({
    data: { userId: input.userId, ...affiliation, isCurrent: true },
  });
  return storeRecoveryCodes(tx, input.userId);
}

async function storeRecoveryCodes(tx: Prisma.TransactionClient, userId: string) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => createRecoveryCode());
  await tx.gatheringRecoveryCode.createMany({
    data: codes.map((code) => ({ userId, codeHash: sha256(normalizeStoredCode(code)) })),
  });
  return codes;
}

function normalizeStoredCode(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export async function hashNewPassword(password: string) {
  return hashPassword(password);
}
