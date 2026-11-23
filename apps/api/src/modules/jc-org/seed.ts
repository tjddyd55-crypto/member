import { normalizeJcName } from '@member/gathering-domain';
import type { JcOrgType, JcVerificationState, Prisma, PrismaClient } from '@prisma/client';
import { aliasSelect, classifyLocal, localMatchIndex, orgNames } from './directory.js';
import { addAliases, asOrgDate, jcOrgTransaction, recordOrgChange } from './write.js';

export type JcSeedRow = {
  registryKey: string;
  type: JcOrgType;
  officialName: string;
  displayName: string;
  shortName: string;
  parentKey: string;
  status: 'ACTIVE' | 'INACTIVE';
  verificationState: JcVerificationState;
  reviewReason: string;
  sourceUrl: string;
  crossCheckUrl: string;
  lastVerifiedAt: string;
  approvalNumber: string;
  aliases: string;
  sortOrder: number;
};

export type JcSeedData = { version: string; districts: JcSeedRow[]; locals: JcSeedRow[] };

type MatchCounts = { matched: number; ambiguous: number; unmatched: number };

function newMatchCounts(): MatchCounts {
  return { matched: 0, ambiguous: 0, unmatched: 0 };
}

function seedFields(row: JcSeedRow) {
  return {
    registryKey: row.registryKey,
    name: row.officialName,
    displayName: row.displayName,
    verificationState: row.verificationState,
    reviewReason: row.reviewReason || null,
    sourceUrl: row.sourceUrl || null,
    lastVerifiedAt: asOrgDate(row.lastVerifiedAt),
  };
}

function namesFrom(row: JcSeedRow) {
  return [row.officialName, row.displayName, ...row.aliases.split('|')];
}

function reconcile<T extends Parameters<typeof orgNames>[0] & { registryKey: string | null }>(
  existing: T[],
  row: JcSeedRow,
) {
  const names = new Set(
    namesFrom(row)
      .map((name) => normalizeJcName(name, row.type))
      .filter(Boolean),
  );
  return existing.filter((org) => [...orgNames(org, row.type)].some((name) => names.has(name)));
}

function hasChanges<T extends object>(current: T, fields: Partial<T>) {
  return Object.entries(fields).some(([key, next]) => {
    const prev = current[key as keyof T];
    if (next instanceof Date && prev instanceof Date) return next.getTime() !== prev.getTime();
    return next !== prev;
  });
}

async function seedInside(tx: Prisma.TransactionClient, data: JcSeedData) {
  const counts = {
    districts: { created: 0, updated: 0 },
    locals: { created: 0, updated: 0, confirmed: 0, needsReview: 0 },
    aliases: 0,
    reconciled: 0,
    conflicts: 0,
    affiliation: newMatchCounts(),
    manual: newMatchCounts(),
  };
  const actorLabel = `seed:jc-organizations@${data.version}`;
  const districtIds = new Map<string, string>();
  const districts = await tx.district.findMany({ include: { jcAliases: aliasSelect } });

  for (const row of data.districts) {
    const keyed = districts.find((org) => org.registryKey === row.registryKey);
    const candidates = keyed ? [keyed] : reconcile(districts, row);
    const before = candidates[0];
    if (
      candidates.length > 1 ||
      (!keyed && before?.registryKey) ||
      (!before && districts.some((org) => org.code === row.registryKey))
    ) {
      counts.conflicts++;
      continue;
    }
    const fields = { ...seedFields(row), sortOrder: row.sortOrder };
    const after = !before
      ? await tx.district.create({
          data: { ...fields, code: row.registryKey, isActive: row.status === 'ACTIVE' },
        })
      : hasChanges(before, fields)
        ? await tx.district.update({ where: { id: before.id }, data: fields })
        : before;
    districtIds.set(row.registryKey, after.id);
    const aliases = await addAliases(tx, 'DISTRICT', after.id, [before?.name, ...namesFrom(row)]);
    counts.aliases += aliases;
    if (!before || after !== before || aliases) {
      if (!before) counts.districts.created++;
      else counts.districts.updated++;
      if (before && !keyed) counts.reconciled++;
      const snapshot = await tx.district.findUniqueOrThrow({
        where: { id: after.id },
        include: { jcAliases: aliasSelect },
      });
      await recordOrgChange(tx, {
        orgType: 'DISTRICT',
        id: after.id,
        action: before ? 'SEED_UPDATE' : 'SEED_CREATE',
        before,
        after: snapshot,
        actorLabel,
      });
    }
  }

  const locals = await tx.local.findMany({ include: { jcAliases: aliasSelect } });
  for (const row of data.locals) {
    const districtId = districtIds.get(row.parentKey);
    if (!districtId) {
      counts.conflicts++;
      continue;
    }
    const keyed = locals.find((org) => org.registryKey === row.registryKey);
    const approvalNumber = row.approvalNumber || null;
    const byApproval = approvalNumber
      ? locals.filter((org) => org.approvalNumber === approvalNumber)
      : [];
    const byName = keyed
      ? []
      : reconcile(
          locals.filter((org) => org.districtId === districtId),
          row,
        );
    const before = keyed ?? byName[0] ?? byApproval[0];
    if (
      byName.length > 1 ||
      (!keyed && before?.registryKey) ||
      byApproval.some((org) => org.id !== before?.id)
    ) {
      counts.conflicts++;
      continue;
    }
    const parentConflict = before != null && before.districtId !== districtId;
    if (parentConflict) counts.conflicts++;
    const fields = { ...seedFields(row), approvalNumber };
    const code = `JC-${row.registryKey}`;
    if (!before && locals.some((org) => org.code === code || org.slug === code.toLowerCase())) {
      counts.conflicts++;
      continue;
    }
    const after = !before
      ? await tx.local.create({
          data: {
            ...fields,
            districtId,
            code,
            slug: code.toLowerCase(),
            isActive: row.status === 'ACTIVE',
          },
        })
      : hasChanges(before, fields)
        ? await tx.local.update({ where: { id: before.id }, data: fields })
        : before;
    const aliases = await addAliases(tx, 'LOCAL', after.id, [before?.name, ...namesFrom(row)]);
    counts.aliases += aliases;
    if (after.verificationState === 'CONFIRMED') counts.locals.confirmed++;
    else counts.locals.needsReview++;
    if (!before || after !== before || aliases) {
      if (!before) counts.locals.created++;
      else counts.locals.updated++;
      if (before && !keyed) counts.reconciled++;
      const snapshot = await tx.local.findUniqueOrThrow({
        where: { id: after.id },
        include: { jcAliases: aliasSelect },
      });
      await recordOrgChange(tx, {
        orgType: 'LOCAL',
        id: after.id,
        action: before ? 'SEED_UPDATE' : 'SEED_CREATE',
        before,
        after: snapshot,
        actorLabel,
        note: parentConflict
          ? `공식 지구: ${row.parentKey}. 기존 소속 지구를 유지했습니다.`
          : undefined,
      });
    }
  }

  const index = await localMatchIndex(tx);
  const affiliations = await tx.gatheringLocalAffiliation.findMany({
    where: { isCurrent: true, localId: null },
    select: { id: true, localJcName: true },
  });
  for (const { id, localJcName } of affiliations) {
    const { outcome, local } = classifyLocal(localJcName, index);
    if (!local) {
      counts.affiliation[outcome]++;
      continue;
    }
    const { count } = await tx.gatheringLocalAffiliation.updateMany({
      where: { id, isCurrent: true, localId: null, localJcName },
      data: { localId: local.id },
    });
    counts.affiliation.matched += count;
  }
  const manual = await tx.gatheringMembership.findMany({
    where: { userId: null, manualLocalId: null, manualLocalJcName: { not: null } },
    select: { id: true, manualLocalJcName: true },
  });
  for (const { id, manualLocalJcName } of manual) {
    if (!manualLocalJcName?.trim()) continue;
    const { outcome, local } = classifyLocal(manualLocalJcName, index);
    if (!local) {
      counts.manual[outcome]++;
      continue;
    }
    const { count } = await tx.gatheringMembership.updateMany({
      where: { id, userId: null, manualLocalId: null, manualLocalJcName },
      data: { manualLocalId: local.id },
    });
    counts.manual.matched += count;
  }
  return counts;
}

class DryRun extends Error {
  constructor(readonly counts: Awaited<ReturnType<typeof seedInside>>) {
    super('Roll back JC organization seed preview');
  }
}

export async function seedJcOrganizations(
  db: PrismaClient,
  data: JcSeedData,
  { dryRun }: { dryRun: boolean },
) {
  try {
    return await jcOrgTransaction(db, async (tx) => {
      const counts = await seedInside(tx, data);
      if (dryRun) throw new DryRun(counts);
      return counts;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.counts;
    throw error;
  }
}
