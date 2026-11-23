import { kstDateKey } from './fiscal-year.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type GatheringSex = 'MALE' | 'FEMALE';

export function isIsoCalendarDate(value: string) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateParts(value: string) {
  const match = ISO_DATE.exec(value);
  return {
    year: Number(match?.[1] ?? 0),
    month: Number(match?.[2] ?? 0),
    day: Number(match?.[3] ?? 0),
  };
}

export function koreanAge(birthDate: string, now = new Date()) {
  const birth = dateParts(birthDate);
  const today = dateParts(kstDateKey(now));
  return today.year - birth.year - (today.month < birth.month || (today.month === birth.month && today.day < birth.day) ? 1 : 0);
}

export function isAllowedBirthDate(value: string, now = new Date()) {
  if (!isIsoCalendarDate(value)) return false;
  const today = kstDateKey(now);
  if (value > today) return false;
  const age = koreanAge(value, now);
  return age >= 0 && age <= 120 && value >= '1900-01-01';
}

export function formatBirthDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
    value.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function parseBirthDate(value: string) {
  return isIsoCalendarDate(value) ? new Date(`${value}T00:00:00.000Z`) : null;
}

export function sexLabel(sex: GatheringSex | null | undefined) {
  if (sex === 'MALE') return '남';
  if (sex === 'FEMALE') return '여';
  return '';
}

export function formatMemberDemographics(input: {
  birthDate: string | null;
  age: number | null;
  sex: GatheringSex | null;
}) {
  if (!input.birthDate && input.age == null && !input.sex) return null;
  const date = input.birthDate ? input.birthDate.replaceAll('-', '.') : '-';
  const age = input.age != null ? `만 ${input.age}세` : '-';
  return `${date} · ${age} · ${sexLabel(input.sex) || '-'}`;
}
