import type { Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

const HIDDEN = ['password', 'secret', 'totp', 'csrf', 'token', 'cipher', 'hash'];

export async function writeAdminAudit(
  db: Db,
  input: {
    actorAdminId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
) {
  await db.gatheringAdminAudit.create({
    data: {
      actorAdminId: input.actorAdminId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      beforeJson: input.before === undefined ? null : JSON.stringify(scrub(input.before)),
      afterJson: input.after === undefined ? null : JSON.stringify(scrub(input.after)),
      reason: input.reason ?? null,
    },
  });
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (HIDDEN.some((part) => key.toLowerCase().includes(part))) continue;
    out[key] = scrub(nested);
  }
  return out;
}
