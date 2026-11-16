import type { GroupAccess } from '../access.js';

export function canManageFolders(access: GroupAccess) {
  return access.roles.includes('PRESIDENT') || access.roles.includes('SECRETARY');
}
