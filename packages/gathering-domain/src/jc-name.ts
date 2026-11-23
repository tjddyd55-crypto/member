export function normalizeJcName(value: string, type: 'LOCAL' | 'DISTRICT' = 'LOCAL'): string {
  const suffix =
    type === 'DISTRICT'
      ? /(?:청년회의소|jc|제이씨|로컬|지구)+$/i
      : /(?:청년회의소|jc|제이씨|로컬)+$/i;
  return value
    .normalize('NFC')
    .trim()
    .replace(/[\s·.()\-]/gu, '')
    .replace(suffix, '');
}
