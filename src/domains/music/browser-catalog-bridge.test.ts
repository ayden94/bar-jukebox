import { expect, test } from "bun:test";
import type { TrackMetadata } from "../../music/contracts";
import type { PlaybackOwner } from "../playback/protocol";
import { BrowserCatalogBridge } from "./browser-catalog-bridge";

const owner: PlaybackOwner = {
  ownerEpoch: 1,
  executorSessionId: "browser-1",
  heartbeatAt: 1,
  released: false,
  stopConfirmed: false,
  connection: {
    target: { providerId: "fixture", modeId: "browser", targetId: "speaker" },
    location: "browser",
    connectionGeneration: "generation-1",
    capabilities: {
      canPlayExactTrack: true,
      canPause: true,
      canResume: true,
      canStop: true,
      canRestart: true,
      canObserveEnd: true,
      canSeek: false,
    },
  },
};
const track: TrackMetadata = {
  ref: { providerId: "fixture", trackId: "exact" },
  title: "곡",
  artist: "가수",
  durationSec: null,
  artwork: null,
  sourceUrl: null,
};
const page = {
  ok: true as const,
  value: { tracks: [track], nextCursor: null },
};

function fixture() {
  let now = 1000;
  const timers = new Map<() => void, number>();
  const bridge = new BrowserCatalogBridge({
    now: () => now,
    schedule(callback, delay) {
      timers.set(callback, now + delay);
      return () => {
        timers.delete(callback);
      };
    },
  });
  bridge.bindOwner(owner);
  const close = bridge.openChannel(owner.executorSessionId);
  return {
    bridge,
    close,
    timers,
    requests: () => bridge.requests(owner.executorSessionId),
    advance(ms: number) {
      now += ms;
      for (const [callback, deadline] of [...timers])
        if (deadline <= now) callback();
    },
  };
}

test("카탈로그 fence: 모든 동일 owner 필드 불일치와 중복은 대기를 해결하지 않아요", async () => {
  const f = fixture();
  try {
    const pending = f.bridge.search("곡", null, new AbortController().signal);
    const request = f.requests()[0]!;
    for (const mismatch of [
      { requestId: "other" },
      { ownerEpoch: 2 },
      { executorSessionId: "other" },
      { connectionGeneration: "other" },
      ...["providerId", "modeId", "targetId"].map((key) => ({
        target: { ...request.target, [key]: "other" },
      })),
    ]) {
      expect(f.bridge.acceptResult({ ...request, ...mismatch }, page)).toBe(
        false,
      );
      expect(f.requests()).toHaveLength(1);
    }
    expect(f.bridge.acceptResult(request, page)).toBe(true);
    expect(await pending).toEqual(page);
    expect(f.bridge.acceptResult(request, page)).toBe(false);
    expect(f.timers.size).toBe(0);
  } finally {
    f.close();
    f.bridge.dispose();
  }
});

test("카탈로그 용량: 실행 포함 32개를 제한하고 abort는 즉시 한 자리를 반환해요", async () => {
  const f = fixture();
  const controllers = Array.from({ length: 32 }, () => new AbortController());
  const promises = controllers.map((abort) =>
    f.bridge.search("곡", null, abort.signal).catch((error: unknown) => error),
  );
  try {
    expect(f.requests()).toHaveLength(32);
    expect(
      await f.bridge.search("초과", null, new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "rate-limited" } });
    const old = f.requests()[0]!;
    controllers[0]!.abort();
    expect(f.requests()).toHaveLength(31);
    expect(f.bridge.acceptResult(old, page)).toBe(false);
    const added = f.bridge
      .search("추가", null, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(f.requests()).toHaveLength(32);
    f.bridge.dispose();
    await Promise.all([...promises, added]);
    expect(f.requests()).toEqual([]);
    expect(f.timers.size).toBe(0);
  } finally {
    f.close();
    f.bridge.dispose();
  }
});

test("카탈로그 deadline: 서버 5초 만료는 취소하고 남은 예산만 전달해요", async () => {
  const f = fixture();
  const pending = f.bridge
    .search("곡", null, new AbortController().signal)
    .catch((error: unknown) => error);
  const request = f.requests()[0]!;

  f.advance(1000);
  expect(f.requests()[0]!.remainingMs).toBe(4000);
  f.advance(4000);

  expect(await pending).toMatchObject({ name: "TimeoutError" });
  expect(f.requests()).toEqual([]);
  expect(f.bridge.acceptResult(request, page)).toBe(false);
  f.close();
  f.bridge.dispose();
});

test("카탈로그 cursor: 원시 토큰을 숨기고 query·5분·연결 수명을 확인해요", async () => {
  const f = fixture();
  try {
    const pending = f.bridge.search("곡", null, new AbortController().signal);
    f.bridge.acceptResult(f.requests()[0], {
      ok: true,
      value: { tracks: [track], nextCursor: "opaque-provider-token" },
    });
    const result = await pending;
    if (!result.ok) throw new Error("페이지가 필요해요");
    const cursor = result.value.nextCursor!;
    expect(cursor).not.toBe("opaque-provider-token");
    expect(
      await f.bridge.search("다른 곡", cursor, new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
    const next = f.bridge.search("곡", cursor, new AbortController().signal);
    expect(f.requests()[0]!.operation).toEqual({
      type: "search",
      query: "곡",
      cursor: "opaque-provider-token",
    });
    f.bridge.acceptResult(f.requests()[0], page);
    await next;
    f.advance(300000);
    expect(
      await f.bridge.search("곡", cursor, new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
  } finally {
    f.close();
    f.bridge.dispose();
  }
});

test("카탈로그 연결: 복원 owner만으로 검색하지 않고 channel 종료와 새 연결은 즉시 취소해요", async () => {
  const f = fixture();
  let notifications = 0;
  const off = f.bridge.subscribe(() => {
    notifications++;
  });
  const pending = f.bridge
    .search("곡", null, new AbortController().signal)
    .catch((error: unknown) => error);
  const old = f.requests()[0]!;

  f.close();

  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(f.requests()).toEqual([]);
  expect(f.bridge.acceptResult(old, page)).toBe(false);
  expect(
    await f.bridge.search("곡", null, new AbortController().signal),
  ).toEqual({ ok: false, error: { code: "disconnected" } });
  expect(notifications).toBeGreaterThan(1);
  off();
  const count = notifications;
  f.bridge.dispose();
  expect(notifications).toBe(count);
});

test("카탈로그 결과: 잘못된 ref·범위는 거절하고 원시 추가 필드는 제거해요", async () => {
  const f = fixture();
  try {
    const input = {
      ...track.ref,
      cookieDeviceId: "private-device",
      tableSecret: "private-table",
    };
    const pending = f.bridge.lookup(input, new AbortController().signal);
    const request = f.requests()[0]!;
    expect(request.operation).toEqual({ type: "lookup", ref: track.ref });
    for (const bad of [
      { ref: { ...track.ref, trackId: "wrong" } },
      { ref: { ...track.ref, providerId: "other" } },
      { durationSec: Infinity },
      { durationSec: -1 },
      { title: "x".repeat(513) },
      { artwork: { providerId: "other", artworkId: "x" } },
      { artwork: { providerId: "fixture", artworkId: "x".repeat(2049) } },
      { sourceUrl: "http://local.test" },
    ])
      expect(
        f.bridge.acceptResult(request, {
          ok: true,
          value: { ...track, ...bad },
        }),
      ).toBe(false);
    expect(
      f.bridge.acceptResult(request, {
        ok: true,
        raw: { cookie: "not-forwarded" },
        value: {
          ...track,
          token: "not-forwarded",
          ref: { ...track.ref, extra: true },
        },
      }),
    ).toBe(true);
    expect(await pending).toEqual({ ok: true, value: track });
  } finally {
    f.close();
    f.bridge.dispose();
  }
});

test("카탈로그 연결 교체: 같은 owner라도 generation 변경은 cursor와 대기를 폐기해요", async () => {
  const f = fixture();
  const first = f.bridge.search("곡", null, new AbortController().signal);
  f.bridge.acceptResult(f.requests()[0], {
    ok: true,
    value: { tracks: [track], nextCursor: "next" },
  });
  const result = await first;
  if (!result.ok) throw new Error("검색 결과가 필요해요");
  const pending = f.bridge
    .lookup(track.ref, new AbortController().signal)
    .catch((error: unknown) => error);
  const old = f.requests()[0]!;

  f.bridge.bindOwner({
    ...owner,
    connection: { ...owner.connection, connectionGeneration: "new" },
  });

  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(f.bridge.acceptResult(old, { ok: true, value: track })).toBe(false);
  expect(
    await f.bridge.search(
      "곡",
      result.value.nextCursor,
      new AbortController().signal,
    ),
  ).toEqual({ ok: false, error: { code: "invalid-track" } });
  f.close();
  f.bridge.dispose();
});
