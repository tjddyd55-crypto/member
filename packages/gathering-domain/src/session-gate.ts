/** 같은 리프레시 토큰으로 동시에 회전하지 않도록 진행 중 요청을 하나만 둔다. */
export class SharedRefreshGate {
  private current: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly attempt: () => Promise<boolean>) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  run() {
    if (!this.current) {
      this.current = this.attempt().finally(() => {
        this.current = null;
      });
    }
    return this.current;
  }

  notifyCleared() {
    for (const listener of this.listeners) listener();
  }
}
