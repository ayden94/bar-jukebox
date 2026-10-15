import type { Snapshot } from "./types";

type SnapshotEnvironment = {
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  createSource: () => Pick<EventTarget, "addEventListener"> &
    Pick<EventSource, "close">;
  fetchState: (signal: AbortSignal) => Promise<{
    ok: boolean;
    json: () => Promise<Snapshot>;
  }>;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (timer: number) => void;
};

export const getServerSnapshot = (): null => null;

export function createSnapshotStore(environment: SnapshotEnvironment) {
  const listeners = new Set<() => void>();
  let snapshot: Snapshot | null = null;
  let source: ReturnType<SnapshotEnvironment["createSource"]> | null = null;
  let poll: number | null = null;
  let request: AbortController | null = null;
  let version = 0;
  let isHidden = false;

  const publish = (next: Snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const invalidate = () => {
    ++version;
    request?.abort();
    request = null;
  };
  const stopPoll = () => {
    if (poll !== null) environment.clearInterval(poll);
    poll = null;
  };
  const refresh = async () => {
    if (!source || isHidden || listeners.size === 0) return;
    invalidate();
    const currentVersion = version;
    const controller = new AbortController();
    request = controller;
    try {
      const response = await environment.fetchState(controller.signal);
      if (!response.ok) return;
      const next = await response.json();
      if (currentVersion === version) publish(next);
    } catch {
      // 연결이 복구되면 SSE 또는 다음 폴링에서 다시 받아요.
    } finally {
      if (request === controller) request = null;
    }
  };
  const stop = () => {
    const previous = source;
    source = null;
    previous?.close();
    stopPoll();
    invalidate();
  };
  const start = () => {
    if (source || isHidden || listeners.size === 0) return;
    const current = environment.createSource();
    source = current;
    current.addEventListener("open", () => {
      if (source === current) stopPoll();
    });
    current.addEventListener("state", (event) => {
      if (source !== current) return;
      try {
        const next = JSON.parse((event as MessageEvent).data) as Snapshot;
        invalidate();
        publish(next);
        stopPoll();
      } catch {
        // 올바른 다음 스냅샷을 기다려요.
      }
    });
    current.addEventListener("error", () => {
      if (source !== current || poll !== null) return;
      void refresh();
      poll = environment.setInterval(() => void refresh(), 3000);
    });
    void refresh();
  };
  const onPageHide = () => {
    isHidden = true;
    stop();
  };
  const onPageShow = () => {
    isHidden = false;
    start();
  };

  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe(listener: () => void) {
      // 같은 콜백을 구독해도 각각의 해제 수명을 유지해요.
      const notify = () => listener();
      listeners.add(notify);
      if (listeners.size === 1) {
        environment.events.addEventListener("pagehide", onPageHide);
        environment.events.addEventListener("pageshow", onPageShow);
        start();
      }
      return () => {
        if (!listeners.delete(notify)) return;
        if (listeners.size !== 0) return;
        stop();
        snapshot = null;
        environment.events.removeEventListener("pagehide", onPageHide);
        environment.events.removeEventListener("pageshow", onPageShow);
        isHidden = false;
      };
    },
  };
}

let browserStore: ReturnType<typeof createSnapshotStore> | undefined;

export function getBrowserSnapshotStore() {
  if (typeof window === "undefined") return null;
  browserStore ??= createSnapshotStore({
    events: window,
    createSource: () => new EventSource("/api/events"),
    fetchState: (signal) => fetch("/api/state", { signal }),
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (timer) => window.clearInterval(timer),
  });
  return browserStore;
}
