export const EVENT_TABS = [
  ['info', '안내·참석'],
  ['media', '사진·영상'],
  ['finance', '재무·영수증'],
] as const;
export type EventTab = (typeof EVENT_TABS)[number][0];
export const ATTENDANCE_OPTIONS = [
  { status: 'ATTENDING', label: '참석' },
  { status: 'DECLINED', label: '불참' },
  { status: 'UNDECIDED', label: '미정' },
] as const;
export function initialEventTab(value: unknown): EventTab {
  return value === 'media' || value === 'finance' ? value : 'info';
}
export function attendanceSummary(counts: {
  attending: number;
  declined: number;
  undecided: number;
}) {
  return `참석 ${counts.attending} · 불참 ${counts.declined} · 미정 ${counts.undecided}`;
}
export function eventActions(permissions: readonly string[]) {
  return {
    edit: permissions.includes('EVENT_MANAGE'),
    finance: permissions.includes('FINANCE_WRITE'),
    receipt: permissions.includes('RECEIPT_WRITE'),
    // Server link managers are PRESIDENT / SECRETARY, the existing event editors.
    uploadLink: permissions.includes('EVENT_MANAGE'),
  };
}
export type FinanceYear = { startsAt: string; endsAt: string; status: string };
/** Server fiscal ranges have inclusive ends, including the final millisecond. */
export function financeYearState(
  instant: string,
  years: readonly FinanceYear[],
): 'OPEN' | 'CLOSED' | 'MISSING' {
  const time = new Date(instant).getTime();
  const state = years.find(
    (year) => time >= Date.parse(year.startsAt) && time <= Date.parse(year.endsAt),
  )?.status;
  return state === 'OPEN' || state === 'CLOSED' ? state : 'MISSING';
}
/** Keep the existing API's single, human-readable place field (120 characters). */
export function eventLocation(place: string, address: string) {
  return [place.trim(), address.trim()].filter(Boolean).join('\n');
}
export function splitEventLocation(value: string | null) {
  const [place = '', ...address] = (value ?? '').split('\n');
  return { place, address: address.join('\n') };
}

export function eventMapQuery(value: string | null) {
  const { place, address } = splitEventLocation(value);
  return (address.trim() || place.trim()).replace(/\s+/g, ' ');
}

/** Longest tab label uses at most 5.5 em; reserve gaps and horizontal padding. */
export function eventTabLabelSize(width: number, fontScale = 1) {
  const labelWidth = Math.max(0, (width - 4) / 3 - 6);
  const scale = Math.max(1, Math.min(fontScale, 1.3));
  return Math.max(1, Math.min(14, Math.floor(labelWidth / (5.5 * scale))));
}
