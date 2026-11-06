import { ADMIN_PASSWORD_MIN } from '@member/gathering-domain';
import { hashPassword } from '../../../services/auth-service.js';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { writeAdminAudit } from './audit.js';

/** 비밀번호는 환경변수로만 받고 반환하지 않는다. 슈퍼관리자가 있으면 다시 만들지 않는다. */
export async function bootstrapSuperAdmin(input: { loginId: string; password: string }) {
  const loginId = input.loginId.trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(loginId)) {
    throw new AppError(400, 'INVALID_LOGIN', '아이디는 3자 이상의 영문, 숫자, ., _, - 만 됩니다.');
  }
  if (input.password.length < ADMIN_PASSWORD_MIN) {
    throw new AppError(400, 'WEAK_PASSWORD', `비밀번호는 ${ADMIN_PASSWORD_MIN}자 이상이어야 합니다.`);
  }
  const existing = await prisma.gatheringAdminAccount.findFirst({
    where: { role: 'SUPER_ADMIN', disabledAt: null },
    select: { id: true },
  });
  if (existing) return { created: false as const };
  const passwordHash = await hashPassword(input.password);
  const created = await prisma.gatheringAdminAccount.create({
    data: { loginId, passwordHash, role: 'SUPER_ADMIN' },
  });
  await writeAdminAudit(prisma, {
    actorAdminId: created.id,
    action: 'ADMIN_BOOTSTRAP',
    targetType: 'GatheringAdminAccount',
    targetId: created.id,
    after: { loginId, role: 'SUPER_ADMIN' },
  });
  return { created: true as const };
}
