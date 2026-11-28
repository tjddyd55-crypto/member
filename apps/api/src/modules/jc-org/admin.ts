import { randomUUID } from 'node:crypto';
import { normalizeJcName } from '@member/gathering-domain';
import { Prisma, type JcOrgType } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { aliasSelect, displayName, orgNames } from './directory.js';
import {
  addAliases,
  asOrgDate,
  duplicateOrg,
  jcOrgTransaction,
  missingOrg,
  recordOrgChange,
} from './write.js';

const verification = z.enum(['CONFIRMED', 'NEEDS_REVIEW']);
const name = z.string().trim().min(1, '조직 이름을 입력하세요.').max(120);
const text = z.string().trim().max(500).nullable().optional();
const fields = z.object({
  name,
  displayName: name.nullish(),
  verificationState: verification.optional(),
  reviewReason: text,
  sourceUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => /^https?:\/\//i.test(value), 'HTTP 또는 HTTPS 주소를 입력하세요.')
    .nullish(),
  lastVerifiedAt: z.string().date().nullish(),
  adminNote: text,
});
const registryKey = z.string().trim().min(1).max(100).optional();
const approvalNumber = z.string().trim().min(1).max(60).nullish();

export const districtCreate = fields.extend({ registryKey });
export const districtPatch = fields.partial();
export const localCreate = districtCreate.extend({ districtId: z.string().cuid(), approvalNumber });
export const localPatch = districtPatch.extend({
  approvalNumber,
  districtId: z.string().cuid().optional(),
});
export const localFilters = z.object({
  districtId: z.string().cuid().optional(),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  service: z.enum(['ENABLED', 'DISABLED']).optional(),
  verification: verification.optional(),
});

type Tx = Prisma.TransactionClient;
const include = { jcAliases: aliasSelect } as const;

export async function adminDistricts() {
  const districts = await prisma.district.findMany({
    include: { locals: { select: { isActive: true, verificationState: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return districts.map(({ locals, ...org }) => ({
    ...org,
    displayName: displayName(org),
    activeLocalCount: locals.filter((local) => local.isActive).length,
    totalLocalCount: locals.length,
    needsReviewCount: locals.filter((local) => local.verificationState === 'NEEDS_REVIEW').length,
  }));
}

export async function adminLocals(filters: z.infer<typeof localFilters>) {
  const query = normalizeJcName(filters.q ?? '');
  const locals = await prisma.local.findMany({
    where: {
      districtId: filters.districtId,
      isActive: filters.status ? filters.status === 'ACTIVE' : undefined,
      serviceEnabled: filters.service ? filters.service === 'ENABLED' : undefined,
      verificationState: filters.verification,
    },
    include,
  });
  return locals
    .filter(
      (org) =>
        !query ||
        [...orgNames(org)].some((label) => label.includes(query)) ||
        org.approvalNumber?.toLowerCase().includes(filters.q?.toLowerCase() ?? ''),
    )
    .map((org) => ({ ...org, displayName: displayName(org) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));
}

export async function adminReview() {
  const [districts, locals] = await Promise.all([
    adminDistricts(),
    adminLocals({ verification: 'NEEDS_REVIEW' }),
  ]);
  return [
    ...districts
      .filter((org) => org.verificationState === 'NEEDS_REVIEW')
      .map((org) => ({ ...org, orgType: 'DISTRICT' })),
    ...locals.map((org) => ({ ...org, orgType: 'LOCAL' })),
  ];
}

async function readOrg(tx: Tx, type: JcOrgType, id: string) {
  const org =
    type === 'DISTRICT'
      ? await tx.district.findUnique({ where: { id }, include })
      : await tx.local.findUnique({ where: { id }, include });
  if (!org) throw missingOrg();
  return org;
}

export async function adminLocal(id: string) {
  const org = await prisma.local.findUnique({ where: { id }, include });
  if (!org) throw missingOrg();
  return { ...org, displayName: displayName(org) };
}

export async function adminOrgHistory(type: JcOrgType, id: string) {
  await readOrg(prisma, type, id);
  return prisma.jcOrganizationHistory.findMany({
    where: { orgType: type, ...(type === 'DISTRICT' ? { districtId: id } : { localId: id }) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { actorAdmin: { select: { loginId: true } } },
  });
}

async function assertUniqueNames(
  tx: Tx,
  type: JcOrgType,
  names: Set<string>,
  id?: string,
  districtId?: string,
) {
  if (!names.size) throw new AppError(400, 'JC_ORG_INVALID_NAME', '유효한 조직 이름을 입력하세요.');
  const others =
    type === 'DISTRICT'
      ? await tx.district.findMany({ where: { id: { not: id } }, include })
      : await tx.local.findMany({ where: { districtId, id: { not: id } }, include });
  if (others.some((org) => [...orgNames(org, type)].some((label) => names.has(label)))) {
    throw duplicateOrg();
  }
}

type Changes = Partial<z.infer<typeof localCreate>>;

function mutateOrg<T>(work: (tx: Tx) => Promise<T>) {
  return jcOrgTransaction(prisma, work).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw duplicateOrg();
    throw error;
  });
}

export function saveAdminOrg(
  actor: { id: string; loginId: string },
  type: JcOrgType,
  input: Changes,
  id?: string,
  note?: string,
) {
  return mutateOrg(async (tx) => {
    const before = id ? await readOrg(tx, type, id) : undefined;
    const local = before && 'districtId' in before ? before : undefined;
    const districtId = input.districtId ?? local?.districtId;
    const moved = local && districtId !== local.districtId;
    const nextName = input.name ?? before?.name;
    if (!nextName) throw new AppError(400, 'JC_ORG_INVALID_NAME', '조직 이름을 입력하세요.');
    const nextDisplayName =
      input.displayName === undefined ? (before?.displayName ?? null) : input.displayName;
    const nameAliases = before
      ? [
          before.name !== nextName ? before.name : null,
          before.displayName !== nextDisplayName ? before.displayName : null,
        ]
      : [];

    if (type === 'LOCAL') {
      if (
        !districtId ||
        ((!local || moved) && !(await tx.district.findUnique({ where: { id: districtId } })))
      )
        throw missingOrg();
      if (
        input.approvalNumber &&
        input.approvalNumber !== local?.approvalNumber &&
        (await tx.local.findFirst({
          where: { approvalNumber: input.approvalNumber, id: { not: id } },
        }))
      )
        throw duplicateOrg();
    }

    const renamed = before && (before.name !== nextName || before.displayName !== nextDisplayName);
    if (!before || moved || renamed) {
      const labels = [nextName, nextDisplayName].filter((value): value is string => value !== null);
      if (labels.some((label) => !normalizeJcName(label, type))) {
        throw new AppError(400, 'JC_ORG_INVALID_NAME', '유효한 조직 이름을 입력하세요.');
      }
      const names = orgNames(
        { name: nextName, displayName: nextDisplayName, jcAliases: before?.jcAliases ?? [] },
        type,
      );
      for (const alias of nameAliases) {
        const normalized = normalizeJcName(alias ?? '', type);
        if (normalized) names.add(normalized);
      }
      await assertUniqueNames(tx, type, names, id, districtId);
    }

    const { lastVerifiedAt, approvalNumber, districtId: newDistrictId, ...fields } = input;
    const data = { ...fields, lastVerifiedAt: asOrgDate(lastVerifiedAt) };
    const code = id ? undefined : `JC-${input.registryKey ?? randomUUID()}`;
    const saved =
      type === 'DISTRICT'
        ? id
          ? await tx.district.update({ where: { id }, data })
          : await tx.district.create({ data: { ...data, name: nextName, code: code! } })
        : id
          ? await tx.local.update({
              where: { id },
              data: { ...data, approvalNumber, districtId: newDistrictId },
            })
          : await tx.local.create({
              data: {
                ...data,
                name: nextName,
                districtId: districtId!,
                approvalNumber,
                code: code!,
                slug: code!.toLowerCase(),
              },
            });

    if (moved) {
      // Keep group scopes consistent: a group scoped to this local follows it to the new district.
      await tx.gatheringGroup.updateMany({
        where: { scopeLocalId: saved.id, scopeDistrictId: { not: null } },
        data: { scopeDistrictId: districtId },
      });
    }
    if (renamed) await addAliases(tx, type, saved.id, nameAliases);
    const after = await readOrg(tx, type, saved.id);
    await recordOrgChange(tx, {
      orgType: type,
      id: saved.id,
      before,
      after,
      actorAdminId: actor.id,
      actorLabel: actor.loginId,
      note,
      action: !before
        ? 'CREATE'
        : moved
          ? 'PARENT_CHANGE'
          : renamed
            ? 'RENAME'
            : before.verificationState !== after.verificationState
              ? 'VERIFY'
              : 'UPDATE',
    });
    return after;
  });
}

export function setAdminOrgStatus(
  actor: { id: string; loginId: string },
  type: JcOrgType,
  id: string,
  active: boolean,
  note?: string,
) {
  return mutateOrg(async (tx) => {
    const before = await readOrg(tx, type, id);
    const args = { where: { id }, data: { isActive: active }, include };
    const after = type === 'LOCAL' ? await tx.local.update(args) : await tx.district.update(args);
    await recordOrgChange(tx, {
      orgType: type,
      id,
      before,
      after,
      action: 'STATUS',
      actorAdminId: actor.id,
      actorLabel: actor.loginId,
      note,
    });
    return after;
  });
}

export function setAdminLocalService(
  actor: { id: string; loginId: string },
  id: string,
  enabled: boolean,
  note?: string,
) {
  return mutateOrg(async (tx) => {
    const before = await tx.local.findUnique({ where: { id }, include });
    if (!before) throw missingOrg();
    if (before.serviceEnabled === enabled) return before;
    if (enabled && !before.isActive) {
      throw new AppError(409, 'JC_ORG_INACTIVE', '활성 로컬에서만 서비스를 켤 수 있습니다.');
    }
    const after = await tx.local.update({
      where: { id },
      data: { serviceEnabled: enabled, serviceEnabledAt: enabled ? new Date() : null },
      include,
    });
    await recordOrgChange(tx, {
      orgType: 'LOCAL',
      id,
      action: 'SERVICE',
      before: { serviceEnabled: before.serviceEnabled },
      after: { serviceEnabled: after.serviceEnabled },
      actorAdminId: actor.id,
      actorLabel: actor.loginId,
      note,
    });
    return after;
  });
}

export function moveAdminLocal(
  actor: { id: string; loginId: string },
  id: string,
  districtId: string,
  note?: string,
) {
  return saveAdminOrg(actor, 'LOCAL', { districtId }, id, note);
}

export function changeAdminLocalAlias(
  actor: { id: string; loginId: string },
  id: string,
  alias: string,
  remove: boolean,
) {
  return mutateOrg(async (tx) => {
    const before = await tx.local.findUnique({ where: { id }, include });
    if (!before) throw missingOrg();
    const normalized = normalizeJcName(alias);
    if (remove) {
      await tx.jcOrganizationAlias.deleteMany({
        where: { localId: id, orgType: 'LOCAL', normalized },
      });
    } else {
      await assertUniqueNames(
        tx,
        'LOCAL',
        new Set(normalized ? [normalized] : []),
        id,
        before.districtId,
      );
      await addAliases(tx, 'LOCAL', id, [alias]);
    }
    const after = await tx.local.findUniqueOrThrow({ where: { id }, include });
    await recordOrgChange(tx, {
      orgType: 'LOCAL',
      id,
      before,
      after,
      action: 'UPDATE',
      actorAdminId: actor.id,
      actorLabel: actor.loginId,
    });
    return after;
  });
}
