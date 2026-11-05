import type { Prisma } from '@prisma/client';
import { hashPassword } from '../../services/auth-service.js';
import { prisma } from '../../lib/prisma.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction, RECOVERY_CODE_COUNT } from './constants.js';
import { createRecoveryCode, sha256 } from './crypto.js';
import { issueGatheringSession } from './sessions.js';

type NewAccount = {
  phone: string;
  passwordHash: string;
  name: string;
  localJcName: string;
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
    localJcName: input.localJcName,
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
  input: { userId: string; name: string; localJcName: string; now: Date },
) {
  await tx.gatheringProfile.create({
    data: {
      userId: input.userId,
      displayName: input.name,
      directoryConsentAt: input.now,
    },
  });
  await tx.gatheringLocalAffiliation.create({
    data: { userId: input.userId, localJcName: input.localJcName, isCurrent: true },
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
