/** 모임 계정은 한국 휴대폰 번호 010xxxxxxxx 만 식별자로 쓴다. */
export function normalizeKoreanMobile(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local = digits.startsWith('82') ? `0${digits.slice(2)}` : digits;
  if (!/^010\d{8}$/.test(local)) return null;
  return local;
}
