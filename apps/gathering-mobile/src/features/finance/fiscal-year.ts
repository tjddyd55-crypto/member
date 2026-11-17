export type FiscalYear = { year: number; startsAt: string; endsAt: string };

export function fiscalYearLabel(
  year: number,
  years: readonly FiscalYear[],
  now: Date,
): string | null {
  const ordered = [...years].sort((a, b) => a.year - b.year);
  const current = ordered.findIndex(
    (item) =>
      new Date(item.startsAt).getTime() <= now.getTime() &&
      now.getTime() <= new Date(item.endsAt).getTime(),
  );
  if (current < 0) return null;
  const index = ordered.findIndex((item) => item.year === year);
  if (index < 0) return null;
  if (index === current) return '올해';
  if (index === current - 1) return '작년';
  if (index === current + 1) return '내년';
  return null;
}

export function fiscalRange(startsAt: string, endsAt: string) {
  const format = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(iso));
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}.${part('month')}.${part('day')}`;
  };
  return `${format(startsAt)} – ${format(endsAt)}`;
}
