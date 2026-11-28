import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../../services/auth-service.js';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { writeGatheringAudit } from '../audit.js';

/**
 * 장부·영수증·스냅샷은 모임 기록이라 지우지 않는다.
 * 이름과 전화번호 연결만 끊는다.
 * 회원수첩 멤버십이 있으면 User 행의 전화와 상태는 그대로 둔다.
 */
export async function deleteGatheringAccount(userId: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { select: { id: true, status: true, approvedAt: true, memberProfileId: true } } },
  });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError(401, 'UNAUTHORIZED', '비밀번호가 올바르지 않습니다.');
  }
  const president = await prisma.gatheringRoleAssignment.findFirst({
    where: { userId, role: 'PRESIDENT', revokedAt: null },
  });
  if (president) {
    throw new AppError(409, 'PRESIDENT_MUST_HANDOVER', '회장 역할은 인계한 뒤에 모임을 떠날 수 있습니다.');
  }
  // 승인되지 않은 가입 요청(PENDING·REJECTED·승인 전 WITHDRAWN)은 회원수첩 자격이 아니므로 계정 정리를 막지 않는다.
  const memberBookKept = user.memberships.some(
    (m) => m.status === 'ACTIVE' || m.status === 'SUSPENDED' || m.approvedAt !== null || m.memberProfileId !== null,
  );
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.gatheringProfile.deleteMany({ where: { userId } });
    await tx.gatheringLocalAffiliation.deleteMany({ where: { userId } });
    await tx.gatheringSession.deleteMany({ where: { userId } });
    await tx.gatheringRecoveryCode.deleteMany({ where: { userId } });
    await tx.gatheringPushToken.deleteMany({ where: { userId } });
    await tx.gatheringMediaAsset.updateMany({ where: { uploaderUserId: userId }, data: { originalName: null } });
    await tx.gatheringReceiptAsset.updateMany({
      where: { uploadedByUserId: userId },
      data: { originalName: null },
    });
    await tx.gatheringRoleAssignment.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: userId },
    });
    await tx.gatheringExecutiveTerm.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: now },
    });
    await tx.gatheringMembership.updateMany({
      where: { userId },
      data: { manualDisplayName: null, manualPhone: null, manualLocalJcName: null, manualLocalId: null },
    });
    await tx.gatheringMembership.updateMany({
      where: { userId, status: { in: ['ACTIVE', 'PENDING'] } },
      data: { status: 'WITHDRAWN' },
    });
    await tx.localMembership.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'WITHDRAWN' },
    });
    if (!memberBookKept) {
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: null,
          email: null,
          status: 'DELETED',
          passwordHash: await hashPassword(randomBytes(24).toString('hex')),
        },
      });
    }
    await writeGatheringAudit(tx, {
      actorUserId: userId,
      action: 'GATHERING_ACCOUNT_DELETE',
      targetType: 'User',
      targetId: userId,
      meta: { memberBookKept },
    });
  });
  return { ok: true as const, memberBookKept };
}
