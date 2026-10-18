import type { PlaybackObservation } from "../../../contracts/index";

export class Observations {
  private readonly subscribers = new Set<{
    push(value: PlaybackObservation): void;
    close(): void;
  }>();
  private closed = false;

  publish(value: PlaybackObservation) {
    for (const subscriber of this.subscribers) subscriber.push(value);
  }

  observe(
    initial: PlaybackObservation,
    signal: AbortSignal,
  ): AsyncIterableIterator<PlaybackObservation, undefined> {
    const buffer = [initial];
    const waiting: ((
      result: IteratorResult<PlaybackObservation, undefined>,
    ) => void)[] = [];
    let closed = false;
    const subscription = {
      push(value: PlaybackObservation) {
        if (closed) return;
        const resolve = waiting.shift();
        if (resolve) resolve({ value, done: false });
        else buffer.push(value);
      },
      close: () => {
        if (closed) return;
        closed = true;
        buffer.length = 0;
        signal.removeEventListener("abort", subscription.close);
        this.subscribers.delete(subscription);
        for (const resolve of waiting.splice(0))
          resolve({ value: undefined, done: true });
      },
    };
    this.subscribers.add(subscription);
    signal.addEventListener("abort", subscription.close, { once: true });
    if (this.closed || signal.aborted) subscription.close();
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (closed) return Promise.resolve({ value: undefined, done: true });
        const value = buffer.shift();
        if (value) return Promise.resolve({ value, done: false });
        return new Promise((resolve) => waiting.push(resolve));
      },
      async return() {
        subscription.close();
        return { value: undefined, done: true };
      },
    };
  }

  close() {
    this.closed = true;
    for (const subscriber of this.subscribers) subscriber.close();
  }
}
