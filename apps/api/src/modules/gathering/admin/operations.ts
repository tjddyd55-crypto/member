import {
  FORMAL_ANNUAL_FEE_WON,
  STORAGE_QUOTA_BYTES,
  adminAllows,
  formalTermExpiry,
  type AdminCapability,
  type AdminRole,
} from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { lockGroup } from '../locks.js';
import { writeAdminAudit } from './audit.js';

type AccountWithScopes = {
  id: string;
  role: AdminRole;
  disabledAt: Date | null;
  scopes: { groupId: string; capability: string }[];
};

export async function adminDashboard(adminId: string) {
  const account = await loadAccount(adminId);
  const ids = groupIdsFor(account, 'GROUP_READ');
  const now = new Date();
  const groupWhere = ids ? { id: { in: ids } } : {};
  const subWhere = ids ? { groupId: { in: ids } } : {};
  const [groupCount, suspendedCount, memberCount, activeTrials, activePaid, expired, used] = await Promise.all([
    prisma.gatheringGroup.count({ where: groupWhere }),
    prisma.gatheringGroup.count({ where: { ...groupWhere, suspendedAt: { not: null } } }),
    prisma.gatheringMembership.count({
      where: { status: 'ACTIVE', ...(ids ? { groupId: { in: ids } } : {}) },
    }),
    prisma.gatheringSubscription.count({
      where: { ...subWhere, source: 'TRIAL', status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } },
    }),
    prisma.gatheringSubscription.count({
      where: { ...subWhere, source: 'PAID', status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } },
    }),
    prisma.gatheringSubscription.count({
      where: { ...subWhere, OR: [{ status: { in: ['EXPIRED', 'REVOKED'] } }, { expiresAt: { lte: now } }] },
    }),
    sumUsedBytes(ids),
  ]);
  return {
    groupCount,
    suspendedCount,
    memberCount,
    activeTrials,
    activePaid,
    expiredCount: expired,
    usedBytes: used,
    generatedAt: now.toISOString(),
  };
}

export async function listScopedMembers(adminId: string, query?: string) {
  const account = await loadAccount(adminId);
  if (!adminAllows({ role: account.role, disabled: false, scopes: account.scopes, capability: 'MEMBER_READ' })) {
    throw new AppError(403, 'FORBIDDEN', '회원 조회 권한이 없습니다.');
  }
  const ids = groupIdsFor(account, 'MEMBER_READ');
  const showContact = adminAllows({
    role: account.role,
    disabled: false,
    scopes: account.scopes,
    capability: 'CONTACT_READ',
  });
  const members = await prisma.gatheringMembership.findMany({
    where: {
      status: { in: ['ACTIVE', 'PENDING', 'SUSPENDED'] },
      ...(ids ? { groupId: { in: ids } } : {}),
      user: query
        ? {
            OR: [
              { phone: { contains: query } },
              { gatheringProfile: { displayName: { contains: query, mode: 'insensitive' } } },
            ],
          }
        : undefined,
    },
    include: {
      user: { include: { gatheringProfile: true, gatheringAffiliations: { where: { isCurrent: true }, take: 1 } } },
      group: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  if (showContact) {
    await writeAdminAudit(prisma, {
      actorAdminId: adminId,
      action: 'ADMIN_CONTACT_LIST',
      after: { count: members.length },
      reason: '회원 연락처 조회',
    });
  }
  return members.map((row) => ({
    membershipId: row.id,
    status: row.status,
    group: row.group,
    user: {
      id: row.user.id,
      name: row.user.gatheringProfile?.displayName ?? null,
      localJcName: row.user.gatheringAffiliations[0]?.localJcName ?? null,
      phone: showContact ? row.user.phone : null,
    },
  }));
}

export async function setGroupSuspension(adminId: string, groupId: string, suspended: boolean, reason: string, idempotencyKey: string) {
  return withOperation(adminId, idempotencyKey, 'SUSPEND', groupId, async (tx, account) => {
    assertCapability(account, 'SUBSCRIPTION_WRITE', groupId);
    if (!reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
    const before = await tx.gatheringGroup.findUnique({ where: { id: groupId }, select: { suspendedAt: true, createdByUserId: true } });
    if (!before) throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
    const suspendedAt = suspended ? before.suspendedAt ?? new Date() : null;
    await tx.gatheringGroup.update({ where: { id: groupId }, data: { suspendedAt } });
    const after = await tx.gatheringGroup.findUnique({ where: { id: groupId }, select: { suspendedAt: true, createdByUserId: true } });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: suspended ? 'ADMIN_SUSPEND' : 'ADMIN_UNSUSPEND',
      targetType: 'GatheringGroup',
      targetId: groupId,
      before: { suspendedAt: before.suspendedAt?.toISOString() ?? null, createdByUserId: before.createdByUserId },
      after: { suspendedAt: after?.suspendedAt?.toISOString() ?? null, createdByUserId: after?.createdByUserId },
      reason: reason.trim(),
    });
    return { groupId, suspended: after?.suspendedAt != null, createdByUserId: after?.createdByUserId };
  });
}

export async function approveSubscription(
  adminId: string,
  groupId: string,
  input: { idempotencyKey: string; reason: string; source?: 'PAID' | 'COMPLIMENTARY'; startsAt?: string; expiresAt?: string },
) {
  return withOperation(adminId, input.idempotencyKey, 'SUBSCRIPTION_APPROVE', groupId, async (tx, account) => {
    assertCapability(account, 'SUBSCRIPTION_WRITE', groupId);
    if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
    const now = new Date();
    const previous = await tx.gatheringSubscription.findFirst({
      where: { groupId, status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
    });
    if (previous) {
      await tx.gatheringSubscription.update({ where: { id: previous.id }, data: { status: 'EXPIRED' } });
    }
    const source = input.source ?? 'PAID';
    const window = termWindow(input.startsAt, input.expiresAt, now, previous?.expiresAt ?? null);
    const created = await tx.gatheringSubscription.create({
      data: {
        groupId,
        status: 'ACTIVE',
        source,
        approvedByAdminId: adminId,
        approvedAt: now,
        startsAt: window.startsAt,
        expiresAt: window.expiresAt,
        storageQuotaBytes: previous?.storageQuotaBytes ?? BigInt(STORAGE_QUOTA_BYTES),
        note: input.reason.trim(),
        idempotencyKey: `admin-sub:${input.idempotencyKey}`,
      },
    });
    const group = await tx.gatheringGroup.findUnique({ where: { id: groupId }, select: { suspendedAt: true, createdByUserId: true } });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: 'ADMIN_SUBSCRIPTION_APPROVE',
      targetType: 'GatheringSubscription',
      targetId: created.id,
      before: { subscriptionId: previous?.id ?? null, expiresAt: previous?.expiresAt?.toISOString() ?? null },
      after: { subscriptionId: created.id, expiresAt: created.expiresAt?.toISOString() ?? null, source, suspended: group?.suspendedAt != null, createdByUserId: group?.createdByUserId },
      reason: input.reason.trim(),
    });
    return { id: created.id, expiresAt: created.expiresAt?.toISOString() ?? null, suspended: group?.suspendedAt != null, createdByUserId: group?.createdByUserId };
  });
}

export async function cancelSubscription(adminId: string, groupId: string, input: { idempotencyKey: string; reason: string }) {
  return withOperation(adminId, input.idempotencyKey, 'SUBSCRIPTION_CANCEL', groupId, async (tx, account) => {
    assertCapability(account, 'SUBSCRIPTION_WRITE', groupId);
    if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
    const current = await tx.gatheringSubscription.findFirst({
      where: { groupId, status: 'ACTIVE' },
      orderBy: { expiresAt: 'desc' },
    });
    if (!current) throw new AppError(409, 'NO_ACTIVE_SUBSCRIPTION', '취소할 이용권이 없습니다.');
    await tx.gatheringSubscription.update({ where: { id: current.id }, data: { status: 'REVOKED' } });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: 'ADMIN_SUBSCRIPTION_CANCEL',
      targetType: 'GatheringSubscription',
      targetId: current.id,
      before: { status: current.status },
      after: { status: 'REVOKED' },
      reason: input.reason.trim(),
    });
    return { id: current.id, status: 'REVOKED' as const };
  });
}

export async function recordDeposit(
  adminId: string,
  groupId: string,
  input: { idempotencyKey: string; payerName: string; amountWon: number; paidOn: string; memo?: string },
) {
  return withOperation(adminId, input.idempotencyKey, 'DEPOSIT_RECORD', groupId, async (tx, account) => {
    assertCapability(account, 'PAYMENT_WRITE', groupId);
    if (!Number.isInteger(input.amountWon) || input.amountWon <= 0) {
      throw new AppError(400, 'INVALID_AMOUNT', '입금액은 1원 이상 정수입니다.');
    }
    const paidOn = new Date(input.paidOn);
    if (Number.isNaN(paidOn.getTime())) throw new AppError(400, 'INVALID_DATE', '입금일이 올바르지 않습니다.');
    const row = await tx.gatheringDeposit.create({
      data: {
        groupId,
        payerName: input.payerName.trim(),
        amountWon: input.amountWon,
        paidOn,
        memo: input.memo?.trim() || null,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: 'ADMIN_DEPOSIT_RECORD',
      targetType: 'GatheringDeposit',
      targetId: row.id,
      after: { amountWon: row.amountWon, status: row.status },
    });
    return { id: row.id, status: row.status, amountWon: row.amountWon };
  });
}

export async function confirmDeposit(
  adminId: string,
  depositId: string,
  input: { idempotencyKey: string; subscriptionId?: string; reason: string; allowMismatch?: boolean },
) {
  const deposit = await prisma.gatheringDeposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw new AppError(404, 'DEPOSIT_NOT_FOUND', '입금 기록을 찾을 수 없습니다.');
  return withOperation(adminId, input.idempotencyKey, 'DEPOSIT_CONFIRM', deposit.groupId, async (tx, account) => {
    if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
    const current = await tx.gatheringDeposit.findUnique({ where: { id: depositId } });
    if (!current) throw new AppError(404, 'DEPOSIT_NOT_FOUND', '입금 기록을 찾을 수 없습니다.');
    assertCapability(account, 'PAYMENT_WRITE', current.groupId);
    if (current.amountWon !== FORMAL_ANNUAL_FEE_WON && input.subscriptionId && !input.allowMismatch) {
      throw new AppError(409, 'AMOUNT_MISMATCH', '금액이 정식 연회비와 다릅니다. 자동으로 연결하지 않습니다.');
    }
    if (input.allowMismatch && account.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'FORBIDDEN', '금액이 다른 입금 연결은 슈퍼관리자만 할 수 있습니다.');
    }
    const updated = await tx.gatheringDeposit.update({
      where: { id: current.id },
      data: { status: 'CONFIRMED', confirmedByAdminId: adminId, confirmedAt: new Date() },
    });
    let linked = false;
    if (input.subscriptionId) {
      const subscription = await tx.gatheringSubscription.findFirst({
        where: { id: input.subscriptionId, groupId: current.groupId },
      });
      if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', '이용권을 찾을 수 없습니다.');
      await tx.gatheringDepositLink.create({ data: { depositId: current.id, subscriptionId: subscription.id } });
      linked = true;
    }
    const subscriptions = await tx.gatheringSubscription.count({ where: { groupId: current.groupId } });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: 'ADMIN_DEPOSIT_CONFIRM',
      targetType: 'GatheringDeposit',
      targetId: current.id,
      after: { status: updated.status, linked },
      reason: input.reason.trim(),
    });
    return { id: updated.id, status: updated.status, linked, subscriptionCount: subscriptions };
  });
}

export async function setGroupQuota(adminId: string, groupId: string, input: { idempotencyKey: string; quotaBytes: number; reason: string }) {
  return withOperation(adminId, input.idempotencyKey, 'QUOTA', groupId, async (tx, account) => {
    assertCapability(account, 'QUOTA_WRITE', groupId);
    if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
    if (!Number.isInteger(input.quotaBytes) || input.quotaBytes < 0) {
      throw new AppError(400, 'INVALID_QUOTA', '용량은 0 이상의 정수 바이트입니다.');
    }
    const current = await tx.gatheringSubscription.findFirst({
      where: { groupId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!current) throw new AppError(409, 'NO_ACTIVE_SUBSCRIPTION', '용량을 바꿀 이용권이 없습니다.');
    const before = Number(current.storageQuotaBytes);
    await tx.gatheringSubscription.update({
      where: { id: current.id },
      data: { storageQuotaBytes: BigInt(input.quotaBytes) },
    });
    const assets = await tx.gatheringMediaAsset.count({ where: { groupId, deletedAt: null } });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: 'ADMIN_QUOTA',
      targetType: 'GatheringSubscription',
      targetId: current.id,
      before: { quotaBytes: before },
      after: { quotaBytes: input.quotaBytes, mediaCount: assets },
      reason: input.reason.trim(),
    });
    return { quotaBytes: input.quotaBytes, mediaCount: assets };
  });
}

export async function replaceAdminScopes(
  actorId: string,
  targetId: string,
  scopes: { groupId: string; capability: AdminCapability }[],
  reason: string,
) {
  if (!reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
  const actor = await loadAccount(actorId);
  if (actor.role !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', '권한 범위는 슈퍼관리자만 바꿉니다.');
  const target = await prisma.gatheringAdminAccount.findUnique({ where: { id: targetId }, include: { scopes: true } });
  if (!target) throw new AppError(404, 'ADMIN_NOT_FOUND', '관리자 계정을 찾을 수 없습니다.');
  if (target.role === 'SUPER_ADMIN') throw new AppError(409, 'SCOPE_NOT_ALLOWED', '슈퍼관리자 범위는 바꾸지 않습니다.');
  await prisma.$transaction(async (tx) => {
    await tx.gatheringAdminScope.deleteMany({ where: { adminId: targetId } });
    if (scopes.length > 0) {
      await tx.gatheringAdminScope.createMany({
        data: scopes.map((scope) => ({ adminId: targetId, groupId: scope.groupId, capability: scope.capability })),
      });
    }
    await writeAdminAudit(tx, {
      actorAdminId: actorId,
      action: 'ADMIN_SCOPE_REPLACE',
      targetType: 'GatheringAdminAccount',
      targetId,
      before: { scopes: target.scopes.map((scope) => ({ groupId: scope.groupId, capability: scope.capability })) },
      after: { scopes },
      reason: reason.trim(),
    });
  });
}

export async function readBankSetting(adminId: string) {
  const account = await loadAccount(adminId);
  if (account.role !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', '계좌 설정은 슈퍼관리자만 봅니다.');
  return prisma.gatheringAdminBankSetting.findUnique({ where: { id: 'bank' } });
}

export async function writeBankSetting(
  adminId: string,
  input: { bankName: string; accountNumber: string; holder: string; memo?: string; reason: string },
) {
  const account = await loadAccount(adminId);
  if (account.role !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', '계좌 설정은 슈퍼관리자만 바꿉니다.');
  if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
  const saved = await prisma.gatheringAdminBankSetting.upsert({
    where: { id: 'bank' },
    create: {
      id: 'bank',
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      holder: input.holder.trim(),
      memo: input.memo?.trim() || null,
      updatedByAdminId: adminId,
    },
    update: {
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      holder: input.holder.trim(),
      memo: input.memo?.trim() || null,
      updatedByAdminId: adminId,
    },
  });
  await writeAdminAudit(prisma, {
    actorAdminId: adminId,
    action: 'ADMIN_BANK_SETTING',
    targetType: 'GatheringAdminBankSetting',
    targetId: saved.id,
    after: { bankName: saved.bankName, holder: saved.holder },
    reason: input.reason.trim(),
  });
  return { bankName: saved.bankName, holder: saved.holder };
}

async function withOperation<T>(
  adminId: string,
  idempotencyKey: string,
  action: string,
  groupId: string,
  run: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], account: AccountWithScopes) => Promise<T>,
): Promise<T> {
  const existing = await prisma.gatheringAdminOperation.findUnique({ where: { idempotencyKey } });
  if (existing) return replay(existing, action);
  const account = await loadAccount(adminId);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockGroup(tx, groupId);
      const again = await tx.gatheringAdminOperation.findUnique({ where: { idempotencyKey } });
      if (again) return replay(again, action);
      const result = await run(tx, account);
      await tx.gatheringAdminOperation.create({
        data: { idempotencyKey, adminId, action, resultJson: JSON.stringify(result) },
      });
      return result;
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    const saved = await prisma.gatheringAdminOperation.findUnique({ where: { idempotencyKey } });
    if (!saved) throw error;
    return replay(saved, action);
  }
}

function replay<T>(row: { action: string; resultJson: string }, action: string): T {
  if (row.action !== action) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '같은 키를 다른 작업에 쓸 수 없습니다.');
  return JSON.parse(row.resultJson) as T;
}

async function sumUsedBytes(ids: string[] | null) {
  const where = {
    deletedAt: null,
    OR: [{ status: 'READY' as const }, { status: 'PENDING' as const }],
    ...(ids ? { groupId: { in: ids } } : {}),
  };
  const [media, receipts] = await Promise.all([
    prisma.gatheringMediaAsset.aggregate({ where, _sum: { sizeBytes: true } }),
    prisma.gatheringReceiptAsset.aggregate({ where, _sum: { sizeBytes: true } }),
  ]);
  return Number(media._sum.sizeBytes ?? 0n) + Number(receipts._sum.sizeBytes ?? 0n);
}

async function loadAccount(adminId: string): Promise<AccountWithScopes> {
  const account = await prisma.gatheringAdminAccount.findUnique({
    where: { id: adminId },
    include: { scopes: true },
  });
  if (!account || account.disabledAt) throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  return account;
}

function groupIdsFor(account: AccountWithScopes, capability: AdminCapability) {
  if (account.role === 'SUPER_ADMIN') return null;
  return account.scopes.filter((scope) => scope.capability === capability).map((scope) => scope.groupId);
}

function assertCapability(account: AccountWithScopes, capability: AdminCapability, groupId: string) {
  if (!adminAllows({ role: account.role, disabled: false, scopes: account.scopes, capability, groupId })) {
    throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  }
}

function termWindow(startsAt: string | undefined, expiresAt: string | undefined, now: Date, currentExpiresAt: Date | null) {
  if (!startsAt && !expiresAt) {
    return { startsAt: now, expiresAt: formalTermExpiry(now, currentExpiresAt, now) };
  }
  if (!startsAt || !expiresAt) throw new AppError(400, 'INVALID_DATE', '시작과 종료를 함께 입력하세요.');
  const start = new Date(startsAt);
  const end = new Date(expiresAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    throw new AppError(400, 'INVALID_DATE', '종료는 시작보다 뒤여야 합니다.');
  }
  return { startsAt: start, expiresAt: end };
}

export async function setMemberRestriction(
  adminId: string,
  groupId: string,
  membershipId: string,
  input: { suspended: boolean; reason: string; idempotencyKey: string },
) {
  return withOperation(adminId, input.idempotencyKey, 'MEMBER_RESTRICTION', groupId, async (tx, account) => {
    assertCapability(account, 'MEMBER_RESTRICT', groupId);
    if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
    const membership = await tx.gatheringMembership.findFirst({ where: { id: membershipId, groupId } });
    if (!membership) throw new AppError(404, 'MEMBER_NOT_FOUND', '회원을 찾을 수 없습니다.');
    const beforeStatus = membership.status;
    const status = input.suspended ? 'SUSPENDED' : 'ACTIVE';
    await tx.gatheringMembership.update({ where: { id: membership.id }, data: { status } });
    const [financeCount, handoverCount] = await Promise.all([
      tx.gatheringFinanceTransaction.count({ where: { groupId } }),
      tx.gatheringHandover.count({ where: { groupId } }),
    ]);
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: input.suspended ? 'ADMIN_MEMBER_RESTRICT' : 'ADMIN_MEMBER_RELEASE',
      targetType: 'GatheringMembership',
      targetId: membership.id,
      before: { status: beforeStatus },
      after: { status, financeCount, handoverCount },
      reason: input.reason.trim(),
    });
    return { membershipId: membership.id, status, financeCount, handoverCount };
  });
}

function isUnique(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
