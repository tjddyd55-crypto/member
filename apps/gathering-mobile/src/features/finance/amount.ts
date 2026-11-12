/** Display-only helpers; API amounts remain integer numbers of won. */
export function formatAmountInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function parseAmountInput(raw: string): number {
  return Number(formatAmountInput(raw).replace(/,/g, ''));
}

export function formatWon(value: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}
