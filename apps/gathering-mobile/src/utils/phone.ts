/** Display/dial normalization only; never writes back to the stored phone. */
export function phoneDigits(value: string): string {
  const cleaned = value.trim().replace(/(?!^\+)\D/g, '');
  if (/^\+?82/.test(cleaned)) {
    const national = cleaned.replace(/^\+?82/, '');
    return national.startsWith('0') ? national : `0${national}`;
  }
  return cleaned.replace(/\D/g, '');
}

export function formatPhone(value: string): string {
  const digits = phoneDigits(value);
  if (/^02\d{7,8}$/.test(digits)) return digits.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^050\d{8}$/.test(digits)) return digits.replace(/^(050\d)(\d{3})(\d{4})$/, '$1-$2-$3');
  if (/^0[1-9]\d\d{7,8}$/.test(digits))
    return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^1[568]\d{6}$/.test(digits)) return digits.replace(/^(\d{4})(\d{4})$/, '$1-$2');
  return value.trim();
}
