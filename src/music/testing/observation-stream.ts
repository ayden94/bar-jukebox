import type { PlaybackObservation } from "../contracts/index";

export function createObservationStream(
  initial: PlaybackObservation,
  signal: AbortSignal,
  onClose: () => void,
) {
  const buffered = [initial];
  const waiting: Array<
    (result: IteratorResult<PlaybackObservation, undefined>) => void
  > = [];
  let isClosed = false;

  function close() {
    if (isClosed) {
      return;
    }
    isClosed = true;
    buffered.length = 0;
    signal.removeEventListener("abort", close);
    for (const resolve of waiting.splice(0)) {
      resolve({ done: true, value: undefined });
    }
    onClose();
  }

  const iterator: AsyncIterableIterator<PlaybackObservation, undefined> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (isClosed) {
        return Promise.resolve({ done: true, value: undefined });
      }
      const snapshot = buffered.shift();
      if (snapshot) {
        return Promise.resolve({ done: false, value: snapshot });
      }
      return new Promise((resolve) => waiting.push(resolve));
    },
    async return() {
      close();
      return { done: true, value: undefined };
    },
  };

  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) {
    isClosed = true;
    buffered.length = 0;
    signal.removeEventListener("abort", close);
  }

  return {
    iterator,
    close,
    push(snapshot: PlaybackObservation) {
      if (isClosed) {
        return;
      }
      const resolve = waiting.shift();
      if (resolve) {
        resolve({ done: false, value: snapshot });
      } else {
        buffered.push(snapshot);
      }
    },
    get isClosed() {
      return isClosed;
    },
  };
}
