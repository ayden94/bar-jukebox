import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useJukeboxSnapshot } from "./hooks";
import {
  createSnapshotStore,
  getBrowserSnapshotStore,
  getServerSnapshot,
} from "./snapshot-store";
import type { Snapshot } from "./types";

function snapshot(notice: string): Snapshot {
  return {
    nowPlaying: null,
    queue: [],
    history: [],
    requestsPaused: false,
    notice,
    maxPerDevice: 1,
    maxPerTable: 5,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class Source extends EventTarget {
  isClosed = false;

  close() {
    this.isClosed = true;
  }

  state(value: Snapshot) {
    this.dispatchEvent(
      new MessageEvent("state", { data: JSON.stringify(value) }),
    );
  }
}

function setup() {
  const events = new EventTarget();
  const sources: Source[] = [];
  const requests: {
    signal: AbortSignal;
    response: ReturnType<
      typeof deferred<{ ok: boolean; json: () => Promise<Snapshot> }>
    >;
  }[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0;
  const store = createSnapshotStore({
    events,
    createSource: () => {
      const source = new Source();
      sources.push(source);
      return source;
    },
    fetchState: (signal) => {
      const response = deferred<{
        ok: boolean;
        json: () => Promise<Snapshot>;
      }>();
      // 취소 직전 완료된 네트워크 응답도 재현해요.
      requests.push({ signal, response });
      return response.promise;
    },
    setInterval: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
  });
  return { store, events, sources, requests, timers };
}

describe("스냅샷 저장소", () => {
  test("구독: 두 소비자가 연결을 공유하고 마지막 해제에서 모두 정리해요", () => {
    const { store, sources, requests } = setup();
    let notifications = 0;
    const listener = () => ++notifications;
    const first = store.subscribe(listener);
    const second = store.subscribe(listener);

    sources[0]!.state(snapshot("공유"));
    first();
    sources[0]!.state(snapshot("남은 소비자"));

    expect(sources).toHaveLength(1);
    expect(notifications).toBe(3);
    expect(sources[0]!.isClosed).toBe(false);
    second();
    expect(sources[0]!.isClosed).toBe(true);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(store.getSnapshot()).toBeNull();
  });

  test("구독: 마지막 해제 뒤 다시 구독하면 새 연결을 만들어요", () => {
    const { store, sources } = setup();
    const unsubscribe = store.subscribe(() => {});
    sources[0]!.state(snapshot("이전"));
    unsubscribe();

    const next = store.subscribe(() => {});

    expect(sources).toHaveLength(2);
    expect(store.getSnapshot()).toBeNull();
    expect(sources[1]!.isClosed).toBe(false);
    next();
  });

  test("페이지 수명: 숨김은 폴링과 읽기를 중단하고 복원은 한 번만 연결해요", async () => {
    const { store, sources, requests, timers, events } = setup();
    const unsubscribe = store.subscribe(() => {});
    sources[0]!.state(snapshot("유지"));
    sources[0]!.dispatchEvent(new Event("error"));
    const pending = store.refresh();
    const request = requests.at(-1)!;

    events.dispatchEvent(new Event("pagehide"));
    request.response.resolve({
      ok: true,
      json: async () => snapshot("오래된 읽기"),
    });
    await pending;

    expect(sources[0]!.isClosed).toBe(true);
    expect(request.signal.aborted).toBe(true);
    expect(timers.size).toBe(0);
    expect(store.getSnapshot()?.notice).toBe("유지");
    await store.refresh();
    expect(requests).toHaveLength(3);
    sources[0]!.state(snapshot("닫힌 연결"));
    sources[0]!.dispatchEvent(new Event("error"));
    expect(timers.size).toBe(0);
    events.dispatchEvent(new Event("pageshow"));
    events.dispatchEvent(new Event("pageshow"));
    expect(sources).toHaveLength(2);
    expect(requests).toHaveLength(4);
    expect(store.getSnapshot()?.notice).toBe("유지");
    unsubscribe();
    expect(requests.at(-1)!.signal.aborted).toBe(true);
  });

  test("페이지 수명: 구독 해제 후 복원 이벤트는 연결을 만들지 않아요", () => {
    const { store, sources, events } = setup();
    const unsubscribe = store.subscribe(() => {});
    events.dispatchEvent(new Event("pagehide"));
    unsubscribe();

    events.dispatchEvent(new Event("pageshow"));

    expect(sources).toHaveLength(1);
  });

  test("새로고침: 응답 본문을 기다리는 사이 받은 SSE를 덮어쓰지 않아요", async () => {
    const { store, sources, requests } = setup();
    const unsubscribe = store.subscribe(() => {});
    const body = deferred<Snapshot>();
    const reading = deferred<void>();
    const pending = store.refresh();
    requests.at(-1)!.response.resolve({
      ok: true,
      json: () => {
        reading.resolve();
        return body.promise;
      },
    });
    await reading.promise;

    sources[0]!.state(snapshot("최신 SSE"));
    body.resolve(snapshot("이전 HTTP"));
    await pending;

    expect(store.getSnapshot()?.notice).toBe("최신 SSE");
    unsubscribe();
  });

  test("새로고침: 늦게 도착한 이전 요청은 최신 요청을 덮어쓰지 않아요", async () => {
    const { store, requests } = setup();
    const unsubscribe = store.subscribe(() => {});
    const first = store.refresh();
    const previous = requests.at(-1)!;
    const second = store.refresh();
    requests.at(-1)!.response.resolve({
      ok: true,
      json: async () => snapshot("최신 HTTP"),
    });
    await second;

    previous.response.resolve({
      ok: true,
      json: async () => snapshot("이전 HTTP"),
    });
    await first;

    expect(previous.signal.aborted).toBe(true);
    expect(store.getSnapshot()?.notice).toBe("최신 HTTP");
    unsubscribe();
  });

  test("새로고침: 구독 해제 후 응답은 스냅샷을 복원하지 않아요", async () => {
    const { store, requests } = setup();
    const unsubscribe = store.subscribe(() => {});
    const pending = store.refresh();
    const request = requests.at(-1)!;

    unsubscribe();
    request.response.resolve({
      ok: true,
      json: async () => snapshot("늦은 응답"),
    });
    await pending;

    expect(request.signal.aborted).toBe(true);
    expect(store.getSnapshot()).toBeNull();
  });

  test("폴링: 오류가 반복되어도 한 타이머만 만들고 연결 복구 시 멈춰요", () => {
    const { store, sources, requests, timers } = setup();
    const unsubscribe = store.subscribe(() => {});
    const source = sources[0]!;

    source.dispatchEvent(new Event("error"));
    source.dispatchEvent(new Event("error"));

    expect(timers.size).toBe(1);
    expect(requests).toHaveLength(2);
    const timer = [...timers.values()][0]!;
    expect(timer.delay).toBe(3000);
    timer.callback();
    expect(requests).toHaveLength(3);
    source.dispatchEvent(new Event("open"));
    expect(timers.size).toBe(0);
    source.dispatchEvent(new Event("error"));
    source.state(snapshot("복구"));
    expect(timers.size).toBe(0);
    source.dispatchEvent(new Event("error"));
    unsubscribe();
    expect(timers.size).toBe(0);
    expect(requests.at(-1)!.signal.aborted).toBe(true);
  });

  test("새로고침: HTTP 오류와 네트워크 실패는 현재 스냅샷을 유지해요", async () => {
    const { store, sources, requests } = setup();
    const unsubscribe = store.subscribe(() => {});
    sources[0]!.state(snapshot("유지"));
    const failed = store.refresh();
    requests.at(-1)!.response.resolve({
      ok: false,
      json: async () => snapshot("오류"),
    });
    await failed;

    const rejected = store.refresh();
    requests.at(-1)!.response.reject(new Error("오프라인"));
    await rejected;

    expect(store.getSnapshot()?.notice).toBe("유지");
    unsubscribe();
  });

  test("SSR: 브라우저 저장소 없이 요청마다 안정적인 null을 반환해요", () => {
    function Probe() {
      return useJukeboxSnapshot(true).snap?.notice ?? "empty";
    }

    const first = renderToString(createElement(Probe));
    const second = renderToString(createElement(Probe));

    expect(first).toBe("empty");
    expect(second).toBe(first);
    expect(getBrowserSnapshotStore()).toBeNull();
    expect(getServerSnapshot()).toBeNull();
  });
});
