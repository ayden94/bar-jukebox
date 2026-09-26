type Wake = "change" | "ping" | "closed";
type Waiter = () => void;

/** SSE 연결 대기자 브로커: 상태 변경 시 모든 연결을 깨운다. */
export class SseBroker {
  readonly #waiters = new Set<Waiter>();

  notify(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  get pendingCount(): number {
    return this.#waiters.size;
  }

  waitChange(signal?: AbortSignal, timeoutMs = 25000): Promise<Wake> {
    if (signal?.aborted) return Promise.resolve("closed");
    return new Promise((resolve) => {
      const finish = (value: Wake) => {
        clearTimeout(timer);
        this.#waiters.delete(waiter);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const waiter = () => finish("change");
      const onAbort = () => finish("closed");
      const timer = setTimeout(() => finish("ping"), timeoutMs);
      this.#waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
