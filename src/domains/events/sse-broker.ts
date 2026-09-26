type Waiter = (value: "change") => void;

/** SSE 연결 대기자 브로커: 상태 변경 시 모든 연결을 깨운다. */
export class SseBroker {
  readonly #waiters = new Set<Waiter>();

  notify(): void {
    for (const waiter of [...this.#waiters]) waiter("change");
  }

  waitChange(): Promise<"change"> {
    return new Promise((resolve) => {
      const waiter: Waiter = () => {
        this.#waiters.delete(waiter);
        resolve("change");
      };
      this.#waiters.add(waiter);
    });
  }
}
