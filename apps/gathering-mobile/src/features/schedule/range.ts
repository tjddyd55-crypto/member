export function toIsoFromLocal(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function kstDate(value: string | Date) {
  return new Date(new Date(value).getTime() + KST_OFFSET_MS);
}
export function formatAlbumDate(value: string) {
  const date = kstDate(value);
  return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}. (${WEEKDAYS[date.getUTCDay()]})`;
}
export function formatEventDateTime(value: string, now = new Date()) {
  const date = kstDate(value);
  const year = date.getUTCFullYear();
  const prefix = year === kstDate(now).getUTCFullYear() ? '' : `${year}.`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} (${WEEKDAYS[date.getUTCDay()]}) ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
