export function formatPhone(value: string): string {
  if (!/^\d+$/.test(value)) return value;
  if (/^02\d{7,8}$/.test(value)) return value.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^0[1-9]\d\d{7,8}$/.test(value))
    return value.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^1[568]\d{6}$/.test(value)) return value.replace(/^(\d{4})(\d{4})$/, '$1-$2');
  return value;
}
export const phoneDigits = (value: string) => value.replace(/\D/g, '');
