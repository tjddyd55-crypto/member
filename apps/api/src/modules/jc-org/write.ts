import { normalizeJcName } from '@member/gathering-domain';
import type { JcOrgType, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { writeAdminAudit } from '../gathering/admin/audit.js';

export function jcOrgTransaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      // Normalized names are checked across names and aliases in several tables.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema()), 610232)`;
      return work(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

export function orgTarget(orgType: JcOrgType, id: string) {
  return orgType === 'LOCAL' ? { localId: id } : { districtId: id };
}

export async function addAliases(
  tx: Prisma.TransactionClient,
  orgType: JcOrgType,
  id: string,
  names: (string | null | undefined)[],
) {
  const data = names.flatMap((name) => {
    const alias = name?.trim();
    const normalized = alias ? normalizeJcName(alias, orgType) : '';
    return alias && normalized ? [{ orgType, ...orgTarget(orgType, id), alias, normalized }] : [];
  });
  if (!data.length) return 0;
  return (await tx.jcOrganizationAlias.createMany({ data, skipDuplicates: true })).count;
}

export async function recordOrgChange(
  tx: Prisma.TransactionClient,
  input: {
    orgType: JcOrgType;
    id: string;
    action:
      | 'CREATE'
      | 'RENAME'
      | 'UPDATE'
      | 'STATUS'
      | 'SERVICE'
      | 'PARENT_CHANGE'
      | 'VERIFY'
      | 'SEED_CREATE'
      | 'SEED_UPDATE';
    before?: object;
    after: object;
    actorAdminId?: string;
    actorLabel?: string;
    note?: string;
  },
) {
  const { orgType, id, action, actorAdminId, actorLabel, note } = input;
  const json = (value: object) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  const before = input.before ? json(input.before) : undefined;
  const after = json(input.after);
  await tx.jcOrganizationHistory.create({
    data: {
      orgType,
      ...orgTarget(orgType, id),
      action,
      before,
      after,
      actorAdminId,
      actorLabel,
      note,
    },
  });
  await writeAdminAudit(tx, {
    actorAdminId,
    action: `JC_ORG_${action}`,
    targetType: orgType === 'LOCAL' ? 'Local' : 'District',
    targetId: id,
    before,
    after,
    reason: note ?? actorLabel,
  });
}

export function duplicateOrg() {
  return new AppError(
    409,
    'JC_ORG_DUPLICATE',
    '같은 이름, 별칭 또는 승인 번호의 JC 조직이 이미 있습니다.',
  );
}

export function missingOrg() {
  return new AppError(404, 'JC_ORG_NOT_FOUND', 'JC 조직을 찾을 수 없습니다.');
}

export function asOrgDate(value: string | null | undefined) {
  return value === undefined ? undefined : value ? new Date(`${value}T00:00:00.000Z`) : null;
}
