let codes: string[] | null = null;

export const recoveryReveal = {
  set(next: string[]) {
    codes = next;
  },
  has() {
    return Boolean(codes && codes.length > 0);
  },
  read() {
    return codes;
  },
  clear() {
    codes = null;
  },
};
