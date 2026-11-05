/** 열린 회계연도 안의 시각. 연도 말에는 다음 날로 넘기지 않는다. */
export function instantInsideOpenYear(
  year: { startsAt: string; endsAt: string },
  now = Date.now(),
) {
  const start = Date.parse(year.startsAt);
  const end = Date.parse(year.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('열린 회계연도를 찾지 못했습니다.');
  }
  const soon = now + 60 * 60 * 1000;
  if (soon >= start && soon <= end) return new Date(soon).toISOString();
  if (now >= start && now <= end) return new Date(now).toISOString();
  return new Date(Math.min(start + 60 * 60 * 1000, end)).toISOString();
}
