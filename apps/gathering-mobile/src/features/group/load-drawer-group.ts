import type { DrawerGroup, HandoverActions } from './app-menu';

export async function loadDrawerGroup<Group extends DrawerGroup>(input: {
  loadGroup: () => Promise<Group>;
  loadHandover: () => Promise<{ actions: HandoverActions }>;
  isActive: () => boolean;
  onGroup: (group: Group) => void;
  onActions: (actions: HandoverActions | null) => void;
}) {
  try {
    const group = await input.loadGroup();
    if (!input.isActive()) return;
    input.onGroup(group);
    if (group.permissions.includes('HANDOVER')) return;
    const handover = await input.loadHandover().catch(() => null);
    if (input.isActive()) input.onActions(handover?.actions ?? null);
  } catch {
    // The drawer starts with no group entries; a failed group request leaves it there.
  }
}
