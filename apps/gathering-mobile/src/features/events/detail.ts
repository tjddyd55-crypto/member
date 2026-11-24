export const EVENT_TABS = [
  ['info', '안내'],
  ['media', '갤러리'],
  ['finance', '회계'],
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
/** Transactions belong to the payment year; receipts belong to the event year. */
export function eventFinanceActions(
  canWrite: boolean,
  canAttach: boolean,
  startsAt: string,
  years: readonly FinanceYear[],
) {
  return {
    addTransaction: canWrite && years.some((year) => year.status === 'OPEN'),
    attachReceipt: canAttach && financeYearState(startsAt, years) === 'OPEN',
  };
}
/** Keep the existing API's single, human-readable place field (120 characters). */
export function eventLocation(place: string, address: string) {
  return [place.trim(), address.trim()].filter(Boolean).join('\n');
}
export function splitEventLocation(value: string | null) {
  const [place = '', ...address] = (value ?? '').split('\n');
  return { place, address: address.join('\n') };
}

const addressNumber = /[로길동리가]\s*\d+(?:-\d+)?(?=[\s,(]|$)/;

export function stripPostcode(s: string) {
  return s
    .trimStart()
    .replace(/^(?:\(\d{5}\)|\[\d{5}\]|\d{5}(?=\s))/, '')
    .trim();
}

export function parseEventAddress(value: string | null) {
  const lines = (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const postcodeIndex = lines.findIndex((line) => /^\(\d{5}\)/.test(line));
  const addressIndex =
    postcodeIndex >= 0 ? postcodeIndex : lines.findIndex((line) => addressNumber.test(line));

  if (addressIndex < 0) {
    // Legacy free text uses the first line as the venue and retains the remaining text.
    const [place = '', ...rest] = lines;
    const detail = rest.map(stripPostcode).filter(Boolean).join(' ');
    return { placeName: stripPostcode(place), road: '', detail, full: detail };
  }

  const placeName = lines.slice(0, addressIndex).map(stripPostcode).filter(Boolean).join(' ');
  const address = stripPostcode(lines[addressIndex]);
  // A road address has one 로/길 + building-number token; fall back to a jibun 동/리/가 token.
  // Text after the number, including parentheticals such as "(운서동)" or "(3층 연회장)", stays in
  // the displayed/copied detail but never reaches the map query.
  const token = (kind: string) =>
    new RegExp(`([${kind}]\\s*\\d+(?:-\\d+)?)(?=[\\s,(]|$)`).exec(address);
  const match = token('로길') ?? token('동리가');
  const road = match ? address.slice(0, match.index + match[1].length) : '';
  const detailStart = match ? match.index + match[1].length : 0;
  const detail = [
    address.slice(detailStart).replace(/^,\s*/, '').trim(),
    ...lines.slice(addressIndex + 1).map(stripPostcode),
  ]
    .filter(Boolean)
    .join(' ');
  return { placeName, road, detail, full: [road, detail].filter(Boolean).join(' ') };
}

export function eventMapQuery(value: string | null) {
  const { placeName, road, full } = parseEventAddress(value);
  return (road || full || placeName).replace(/\s+/g, ' ');
}

export function eventCopyAddress(value: string | null) {
  const { placeName, full } = parseEventAddress(value);
  return full || placeName;
}

export function eventMapUrls(q: string): [appUrl: string, webUrl: string] {
  const query = encodeURIComponent(q);
  return [
    `nmap://search?query=${query}&appname=kr.jcikorea.app`,
    `https://map.naver.com/p/search/${query}`,
  ];
}

/** Longest tab label uses at most 5.5 em; reserve gaps and horizontal padding. */
export function eventTabLabelSize(width: number, fontScale = 1) {
  const labelWidth = Math.max(0, (width - 4) / 3 - 6);
  const scale = Math.max(1, Math.min(fontScale, 1.3));
  return Math.max(1, Math.min(14, Math.floor(labelWidth / (5.5 * scale))));
}
