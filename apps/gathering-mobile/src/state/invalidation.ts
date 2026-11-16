export type DataKind = 'media' | 'finance' | 'schedule';
const versions = new Map<string, number>();
const listeners = new Set<() => void>();
export const dataVersion = (groupId: string, kind: DataKind) =>
  versions.get(`${groupId}:${kind}`) ?? 0;
export function subscribeInvalidation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function invalidate(groupId: string, kind: DataKind) {
  const key = `${groupId}:${kind}`;
  versions.set(key, dataVersion(groupId, kind) + 1);
  if (kind === 'schedule' && groupId !== '*')
    versions.set('*:schedule', dataVersion('*', 'schedule') + 1);
  for (const listener of listeners) listener();
}

// Called only after the server accepts a mutation. Upload reservations are not completed media.
export function invalidateMutation(path: string, method: string) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
  const match = path.match(/^\/api\/gathering\/groups\/([^/]+)\/(.+)$/);
  if (!match) return;
  const [, groupId, resource] = match;
  if (/^events(?:\/[^/]+)?$/.test(resource)) {
    invalidate(groupId, 'schedule');
    invalidate(groupId, 'media');
  }
  if (/^events\/[^/]+\/attendance$/.test(resource)) invalidate(groupId, 'schedule');
  if (
    /^(folders(?:\/[^/]+)?|media\/[^/]+)$/.test(resource) ||
    /(?:media\/[^/]+\/complete|media\/delete)$/.test(resource)
  )
    invalidate(groupId, 'media');
  if (
    /^(transactions\/|finance\/dues)/.test(resource) ||
    /^events\/[^/]+\/transactions$/.test(resource) ||
    /receipts\/[^/]+\/complete$/.test(resource)
  )
    invalidate(groupId, 'finance');
}
