import type { GatheringPermission, GatheringRole } from '@member/gathering-domain';
import { isGatheringRole, permissionsForRoles } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export type GroupAccess = {
  membershipId: string;
  userId: string;
  groupId: string;
  roles: GatheringRole[];
  permissions: GatheringPermission[];
  restricted: boolean;
};

export async function requireGroupMember(
  userId: string,
  groupId: string,
  mode: 'read' | 'write' = 'write',
): Promise<GroupAccess> {
  const membership = await prisma.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    include: { roles: { where: { revokedAt: null } } },
  });
  if (!membership || membership.status === 'REJECTED' || membership.status === 'WITHDRAWN') {
    throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  }
  if (membership.status === 'SUSPENDED') {
    throw new AppError(403, 'MEMBERSHIP_BLOCKED', '이 모임에서 사용할 수 없는 상태입니다.');
  }
  if (membership.status === 'PENDING') {
    throw new AppError(403, 'MEMBERSHIP_PENDING', '회장 또는 총무의 승인을 기다리는 중입니다.');
  }

  const roles = membership.roles.map((row) => row.role).filter(isGatheringRole);
  return {
    membershipId: membership.id,
    userId,
    groupId,
    roles,
    permissions: permissionsForRoles(roles),
    restricted: membership.status === 'SUSPENDED',
  };
}

export function assertPermission(access: GroupAccess, permission: GatheringPermission) {
  if (!access.permissions.includes(permission)) {
    throw new AppError(403, 'FORBIDDEN', '이 모임에서 해당 작업을 할 권한이 없습니다.');
  }
}
