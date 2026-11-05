import { describe, expect, it } from 'vitest';
import { SharedRefreshGate } from './session-gate.js';

describe('리프레시 단일 진행', () => {
  it('동시에 두 번 호출해도 회전은 한 번만 실행한다', async () => {
    let calls = 0;
    let finish: (value: boolean) => void = () => undefined;
    const gate = new SharedRefreshGate(
      () =>
        new Promise((resolve) => {
          calls += 1;
          finish = resolve;
        }),
    );
    const first = gate.run();
    const second = gate.run();
    expect(calls).toBe(1);
    finish(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it('실패를 구독자에게 알리고, 끝난 뒤에는 다시 시도할 수 있다', async () => {
    let calls = 0;
    const gate = new SharedRefreshGate(async () => {
      calls += 1;
      return false;
    });
    const cleared: string[] = [];
    gate.subscribe(() => cleared.push('cleared'));
    await gate.run();
    gate.notifyCleared();
    await gate.run();
    expect(calls).toBe(2);
    expect(cleared).toEqual(['cleared']);
  });
});
