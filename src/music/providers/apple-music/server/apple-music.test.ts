import { afterEach, expect, test } from "bun:test";
import type {
  MusicResult,
  PlaybackContext,
  PlaybackObservation,
  TrackRef,
} from "../../../contracts/index";
import { appleMusicDescriptor } from "../index";
import { createAppleMusicServer } from "./index";
import type { NativeSnapshot } from "./native";

const signal = new AbortController().signal;
const ref: TrackRef = { providerId: "apple-music", trackId: "123" };
const rawTrack = {
  wrapperType: "track",
  kind: "song",
  trackId: 123,
  trackName: "노래",
  artistName: "가수",
  collectionName: "앨범",
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
  trackViewUrl: "https://music.apple.com/kr/album/album/456?i=123",
  trackNumber: 2,
  discNumber: 1,
  trackTimeMillis: 201000,
};
const nativeTrack: NativeSnapshot = {
  state: "playing",
  id: "native-940",
  persistentId: "AA940",
  title: "노래",
  artist: "가수",
  album: "앨범",
  trackNumber: 2,
  discNumber: 1,
  positionSec: 1,
  durationSec: 201,
};
const dispose: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of dispose.splice(0)) {
    await cleanup();
  }
});

function value<T>(result: MusicResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error.code);
  }
  return result.value;
}

function encoded(snapshot: NativeSnapshot) {
  return [
    snapshot.state,
    snapshot.id,
    snapshot.persistentId,
    snapshot.title,
    snapshot.artist,
    snapshot.album,
    snapshot.trackNumber,
    snapshot.discNumber,
    snapshot.positionSec ?? "",
    snapshot.durationSec ?? "",
  ].join("\x1f");
}

async function fixture(
  overrides: Parameters<typeof createAppleMusicServer>[0] = {},
  results: unknown[] = [rawTrack],
) {
  const scripts: string[] = [];
  const urls: string[] = [];
  let native = { ...nativeTrack };
  let scheduled: (() => void) | null = null;
  const provider = value(
    await createAppleMusicServer(
      {
        platform: "darwin",
        fetch: async (url) => {
          urls.push(url);
          return Response.json({ results });
        },
        runScript: async (script, requestSignal) => {
          requestSignal.throwIfAborted();
          scripts.push(script);
          if (script.startsWith("-- jukebox:connect")) {
            return native.state;
          }
          if (script.startsWith("-- jukebox:control")) {
            if (
              !script.includes(`"${native.id}"`) ||
              !script.includes(`"${native.persistentId}"`)
            ) {
              return "mismatch";
            }
            if (script.includes("\n  stop\n")) native.state = "stopped";
            if (script.includes("\n  pause\n")) native.state = "paused";
            if (script.includes("\n  play\n")) native.state = "playing";
            const position = /set player position to ([\d.]+)/.exec(script);
            if (position) native.positionSec = Number(position[1]);
            return "applied";
          }
          if (script.startsWith("-- jukebox:prepare")) {
            native = {
              ...nativeTrack,
              positionSec: 0,
              state: script.includes("\n    pause\n") ? "paused" : "playing",
            };
          }
          return encoded(native);
        },
        schedulePoll: (callback) => {
          scheduled = callback;
          return () => {
            if (scheduled === callback) scheduled = null;
          };
        },
        ...overrides,
      },
      signal,
    ),
  );
  dispose.push(() => provider.dispose());
  if (provider.execution.location !== "server") {
    throw new Error("서버 실행기가 필요해요");
  }
  const runtime = provider.execution.runtime;
  let context: PlaybackContext;
  return {
    provider,
    runtime,
    scripts,
    urls,
    get scheduled() {
      return scheduled;
    },
    get context() {
      return context;
    },
    setNative(update: Partial<NativeSnapshot>) {
      native = { ...native, ...update };
    },
    async connect() {
      const target = value(await runtime.connection.listTargets(signal))[0]!;
      const connected = value(
        await runtime.connection.connect(target.ref, signal),
      );
      context = {
        target: connected.target,
        connectionGeneration: connected.connectionGeneration,
        commandId: "play-1",
        attemptId: "attempt-1",
        executorSessionId: "executor-1",
      };
      return connected;
    },
    play(initialState: "playing" | "paused" = "playing") {
      return runtime.playback.execute(
        { type: "play", context, trackRef: ref, initialState },
        signal,
      );
    },
    async tick(
      iterator: AsyncIterableIterator<PlaybackObservation, undefined>,
    ) {
      const next = iterator.next();
      const callback = scheduled;
      if (!callback) throw new Error("예약된 관측이 필요해요");
      scheduled = null;
      callback();
      return (await next).value!;
    },
  };
}

test("팩토리: 초기화와 descriptor는 네트워크나 프로세스를 실행하지 않아요", async () => {
  const instance = await fixture();

  expect(appleMusicDescriptor.modes.map((mode) => mode.modeId)).toEqual([
    "applescript",
  ]);
  expect(instance.scripts).toEqual([]);
  expect(instance.urls).toEqual([]);
});

test("lookup: ID만 조회하고 공개 메타데이터에 native 자료를 노출하지 않아요", async () => {
  const instance = await fixture();

  const track = value(await instance.provider.catalog.lookup(ref, signal));

  expect(new URL(instance.urls[0]!).searchParams.get("id")).toBe("123");
  expect(track).toEqual({
    ref,
    title: "노래",
    artist: "가수",
    durationSec: 201,
    artwork: {
      providerId: "apple-music",
      artworkId: "https://is1-ssl.mzstatic.com/image/300x300bb.jpg",
    },
    sourceUrl: rawTrack.trackViewUrl,
  });
});

test("lookup: 잘못된 문자열 ID는 네트워크 전에 거절해요", async () => {
  const instance = await fixture();

  for (const trackId of [
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    " 123",
    "0123",
    "123&entity=movie",
  ]) {
    expect(
      await instance.provider.catalog.lookup({ ...ref, trackId }, signal),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
  }
  expect(
    await instance.provider.catalog.lookup(
      { ...ref, providerId: "other" },
      signal,
    ),
  ).toEqual({ ok: false, error: { code: "invalid-track" } });
  expect(instance.urls).toEqual([]);
});

test("검색: 곡 종류와 메타데이터를 검사하고 중복을 제거해요", async () => {
  const instance = await fixture({}, [
    rawTrack,
    rawTrack,
    { ...rawTrack, trackNumber: -1 },
    { ...rawTrack, trackId: 124, kind: "podcast" },
  ]);

  const page = value(
    await instance.provider.catalog.search("노래 & artist", null, signal),
  );

  expect(page.tracks.map((track) => track.ref.trackId)).toEqual(["123"]);
  expect(page.nextCursor).toBeNull();
  expect(new URL(instance.urls[0]!).searchParams.get("term")).toBe(
    "노래 & artist",
  );
  expect(
    await instance.provider.catalog.search("노래", "foreign-cursor", signal),
  ).toEqual({ ok: false, error: { code: "unsupported" } });
});

test("lookup: 빈 결과와 외부 요청 실패를 정규화해 구분해요", async () => {
  const empty = await fixture({}, []);
  const wrongId = await fixture({}, [{ ...rawTrack, trackId: 124 }]);
  const invalidShape = await fixture({
    fetch: async () => Response.json({ wrong: [] }),
  });
  const offline = await fixture({
    fetch: async () => {
      throw new Error("비밀 원시 오류");
    },
  });
  const serverError = await fixture({
    fetch: async () => new Response(null, { status: 503 }),
  });
  const invalidJson = await fixture({ fetch: async () => new Response("{") });

  for (const instance of [empty, wrongId]) {
    expect(await instance.provider.catalog.lookup(ref, signal)).toEqual({
      ok: false,
      error: { code: "invalid-track" },
    });
  }
  expect(await invalidShape.provider.catalog.lookup(ref, signal)).toEqual({
    ok: false,
    error: { code: "unplayable" },
  });
  for (const instance of [offline, serverError, invalidJson]) {
    expect(await instance.provider.catalog.lookup(ref, signal)).toEqual({
      ok: false,
      error: { code: "disconnected" },
    });
  }
});

test("lookup: 재생 불가능한 자료와 조작된 Apple URL을 거절해요", async () => {
  const invalid = [
    { kind: "podcast" },
    { wrapperType: "collection" },
    { trackNumber: 0 },
    { trackNumber: 201 },
    { trackNumber: 2.5 },
    { trackTimeMillis: -1 },
    { trackTimeMillis: 0 },
    { trackName: " " },
    { artistName: "" },
    { trackId: Number.MAX_SAFE_INTEGER + 1 },
    { trackViewUrl: "http://music.apple.com/kr/album/x/456" },
    { trackViewUrl: "https://music.apple.com.evil.example/kr/album/x/456" },
    { trackViewUrl: "https://music.apple.com@evil.example/kr/album/x/456" },
    { trackViewUrl: "https://music.apple.com/kr/playlist/x/456" },
    { trackViewUrl: "https://music.apple.com:8443/kr/album/x/456" },
  ];

  for (const override of invalid) {
    const instance = await fixture({}, [{ ...rawTrack, ...override }]);
    const page = value(
      await instance.provider.catalog.search("노래", null, signal),
    );
    expect(page.tracks).toEqual([]);
    expect(await instance.provider.catalog.lookup(ref, signal)).toEqual({
      ok: false,
      error: { code: "invalid-track" },
    });
  }
  const nonFinite = await fixture({
    fetch: async () =>
      new Response(
        JSON.stringify({ results: [rawTrack] }).replace(
          '"trackTimeMillis":201000',
          '"trackTimeMillis":1e400',
        ),
      ),
  });
  expect(await nonFinite.provider.catalog.lookup(ref, signal)).toEqual({
    ok: false,
    error: { code: "invalid-track" },
  });
});

test("lookup: 길이 미제공과 앨범명 미제공은 가짜 길이를 만들지 않아요", async () => {
  const instance = await fixture({}, [
    {
      ...rawTrack,
      trackTimeMillis: null,
      collectionName: undefined,
    },
  ]);

  const track = value(await instance.provider.catalog.lookup(ref, signal));

  expect(track.durationSec).toBeNull();
});

test("재생 준비: iTunes URL을 안전한 앨범 URL로 바꾸고 음소거 후 이동해요", async () => {
  const instance = await fixture({}, [
    {
      ...rawTrack,
      trackViewUrl: "https://itunes.apple.com/us/album/test/id456?i=123#part",
    },
  ]);
  await instance.connect();

  expect((await instance.play()).status).toBe("accepted");

  const script = instance.scripts.find((item) =>
    item.startsWith("-- jukebox:prepare"),
  )!;
  expect(script).toContain(
    'open location "music://itunes.apple.com/us/album/test/id456"',
  );
  expect(script.indexOf("set sound volume to 0")).toBeLessThan(
    script.indexOf("open location"),
  );
  expect(script).toContain("next track");
  expect(script).toContain("set sound volume to originalVolume\n    error");
});

test("명령 접수: 실제 다음 관측 전에는 playing을 만들지 않아요", async () => {
  const instance = await fixture();
  await instance.connect();
  const iterator = instance.runtime.playback.observe(signal);
  expect((await iterator.next()).value?.state).toBe("unknown");

  expect((await instance.play()).status).toBe("accepted");
  instance.setNative({ state: "paused" });
  const observed = await instance.tick(iterator);

  expect(observed.state).toBe("paused");
  expect(observed.trackRef).toEqual(ref);
  expect(observed.correlation?.attemptId).toBe("attempt-1");
  expect(observed.binding?.payload).toMatchObject({
    nativeId: "native-940",
    trackId: "123",
  });
});

test("관측: 무관한 추천곡으로 바뀌면 종료하거나 외부 음악을 정지하지 않아요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  instance.setNative({ positionSec: 200.9 });
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  instance.setNative({
    id: "other",
    persistentId: "OTHER",
    title: "추천",
    album: "다른 앨범",
    trackNumber: 3,
    positionSec: 0,
  });

  const observed = await instance.tick(iterator);

  expect(observed.state).toBe("unknown");
  expect(observed.trackRef).toBeNull();
  expect(observed.correlation).toEqual({
    commandId: instance.context.commandId,
    attemptId: instance.context.attemptId,
    executorSessionId: instance.context.executorSessionId,
  });
  expect(
    instance.scripts.filter((script) =>
      script.startsWith("-- jukebox:control"),
    ),
  ).toEqual([]);
});

test("관측: 같은 앨범의 다음 번호라도 종료 위치 증거가 없으면 정지하지 않아요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  instance.setNative({
    id: "next",
    persistentId: "NEXT",
    trackNumber: 3,
    positionSec: 0,
  });

  expect((await instance.tick(iterator)).state).toBe("unknown");

  expect(
    instance.scripts.filter((script) =>
      script.startsWith("-- jukebox:control"),
    ),
  ).toEqual([]);
});

test("관측: 소유 앨범 순차 진행과 종료 위치를 확인하면 조건부 정지 후 종료해요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  instance.setNative({ positionSec: 200.8 });
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  instance.setNative({
    id: "next",
    persistentId: "NEXT",
    trackNumber: 3,
    positionSec: 0.1,
  });

  const observed = await instance.tick(iterator);

  expect(observed.state).toBe("ended");
  expect(observed.endReason).toBe("owned-advance");
  expect(observed.trackRef).toEqual(ref);
  const stop = instance.scripts.find((script) =>
    script.startsWith("-- jukebox:control"),
  )!;
  expect(stop).toContain('"next"');
  expect(stop).toContain('"NEXT"');
  const context = { ...instance.context, commandId: "finish-stop" };
  expect(
    (await instance.runtime.playback.execute({ type: "stop", context }, signal))
      .status,
  ).toBe("accepted");
  expect(await instance.tick(iterator)).toMatchObject({
    state: "stopped",
    correlation: { commandId: "finish-stop" },
  });
});

test("재시작은 같은 실행기의 새 시도를 받아 이전 시도 명령을 거절해요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  const context = {
    ...instance.context,
    attemptId: "attempt-2",
    commandId: "restart-2",
  };
  expect(
    (
      await instance.runtime.playback.execute(
        { type: "restart", context, initialState: "paused" },
        signal,
      )
    ).status,
  ).toBe("accepted");
  expect(await instance.tick(iterator)).toMatchObject({
    state: "paused",
    correlation: { attemptId: "attempt-2" },
  });
  expect(
    (
      await instance.runtime.playback.execute(
        { type: "pause", context: instance.context },
        signal,
      )
    ).status,
  ).toBe("rejected");
});

test("관측: 자연 종료는 같은 native 곡의 실제 종료 위치와 정지를 함께 확인해요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  instance.setNative({ positionSec: 200.9 });
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  instance.setNative({ state: "stopped", positionSec: 0 });

  expect(await instance.tick(iterator)).toMatchObject({
    state: "ended",
    endReason: "natural-end",
  });
});

test("관측: 정지와 위치 0만으로는 자연 종료를 만들지 않아요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  instance.setNative({ state: "stopped", positionSec: 0 });

  expect((await instance.tick(iterator)).state).toBe("stopped");
});

test("제어: pause resume restart seek stop은 다음 native 관측으로 확인해요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();
  for (const [type, state] of [
    ["pause", "paused"],
    ["resume", "playing"],
    ["stop", "stopped"],
  ] as const) {
    const outcome = await instance.runtime.playback.execute(
      {
        type,
        context: { ...instance.context, commandId: type },
      },
      signal,
    );
    expect(outcome.status).toBe("accepted");
    expect((await instance.tick(iterator)).state).toBe(state);
  }
  const restart = await instance.runtime.playback.execute(
    {
      type: "restart",
      context: instance.context,
      initialState: "paused",
    },
    signal,
  );
  expect(restart.status).toBe("accepted");
  expect(await instance.tick(iterator)).toMatchObject({
    state: "paused",
    positionSec: 0,
  });
  expect(
    (
      await instance.runtime.playback.execute(
        {
          type: "seek",
          context: instance.context,
          positionSec: 3.25,
        },
        signal,
      )
    ).status,
  ).toBe("accepted");
  expect((await instance.tick(iterator)).positionSec).toBe(3.25);
});

test("reconcile: 정확한 native binding만 복원하고 다른 곡을 재생하지 않아요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.play();
  const iterator = instance.runtime.playback.observe(signal);
  const binding = (await iterator.next()).value!.binding!;
  await iterator.return?.();
  const before = instance.scripts.length;
  await instance.connect();

  const restored = value(
    await instance.runtime.playback.reconcile(binding, signal),
  );

  expect(restored.status).toBe("match");
  expect(
    instance.scripts
      .slice(before)
      .every((script) => !script.startsWith("-- jukebox:prepare")),
  ).toBe(true);
  instance.setNative({ id: "foreign" });
  expect(
    value(await instance.runtime.playback.reconcile(binding, signal)).status,
  ).toBe("mismatch");
  expect(
    value(
      await instance.runtime.playback.reconcile(
        { ...binding, version: 999 },
        signal,
      ),
    ).status,
  ).toBe("unknown");
});

test("관측 수명: abort return dispose는 대기 중 next와 예약을 정리해요", async () => {
  for (const close of ["abort", "return", "dispose"] as const) {
    const instance = await fixture();
    const controller = new AbortController();
    const iterator = instance.runtime.playback.observe(controller.signal);
    expect((await iterator.next()).value?.state).toBe("unavailable");
    const pending = iterator.next();

    if (close === "abort") controller.abort();
    if (close === "return") await iterator.return?.();
    if (close === "dispose") await instance.provider.dispose();

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(instance.scheduled).toBeNull();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  }
});

test("disabled와 미지원 OS: 카탈로그는 작동하지만 프로세스와 ready는 없어요", async () => {
  for (const options of [{ disabled: true }, { platform: "win32" }]) {
    const instance = await fixture(options);
    const target = {
      providerId: "apple-music",
      modeId: "applescript",
      targetId: "local-music-app",
    };

    expect(
      value(await instance.provider.catalog.lookup(ref, signal)).ref,
    ).toEqual(ref);
    expect(
      value(await instance.runtime.connection.listTargets(signal)),
    ).toEqual([]);
    expect((await instance.runtime.connection.connect(target, signal)).ok).toBe(
      false,
    );
    expect((await instance.provider.auth.connect(signal)).ok).toBe(false);
    expect(instance.scripts).toEqual([]);
  }
});

test("명령 실패: 발행 후 오류는 성공이나 확정 실패 대신 unknown을 반환해요", async () => {
  const instance = await fixture({
    runScript: async (script) => {
      if (script.startsWith("-- jukebox:connect")) return "stopped";
      throw new Error("native secret");
    },
  });
  await instance.connect();

  expect(await instance.play()).toEqual({
    status: "unknown",
    context: instance.context,
    error: { code: "unknown-outcome" },
  });
});

test("명령 취소: 발행 전 취소는 reject하고 발행 후 취소는 unknown이에요", async () => {
  const issued = Promise.withResolvers<void>();
  const completion = Promise.withResolvers<string>();
  const instance = await fixture({
    runScript: async (script) => {
      if (script.startsWith("-- jukebox:connect")) return "stopped";
      issued.resolve();
      return completion.promise;
    },
  });
  await instance.connect();
  const controller = new AbortController();
  const pending = instance.runtime.playback.execute(
    {
      type: "play",
      trackRef: ref,
      initialState: "playing",
      context: instance.context,
    },
    controller.signal,
  );
  await issued.promise;

  controller.abort(new Error("취소"));
  completion.resolve(encoded(nativeTrack));

  expect((await pending).status).toBe("unknown");
  await expect(
    instance.runtime.playback.execute(
      {
        type: "play",
        trackRef: ref,
        initialState: "playing",
        context: instance.context,
      },
      controller.signal,
    ),
  ).rejects.toThrow("취소");
});

test("연결 세대: 재연결 전 명령을 외부 호출 전에 거절해요", async () => {
  const instance = await fixture();
  await instance.connect();
  const oldContext = instance.context;
  await instance.connect();
  const before = instance.scripts.length;

  const outcome = await instance.runtime.playback.execute(
    {
      type: "play",
      context: oldContext,
      trackRef: ref,
      initialState: "playing",
    },
    signal,
  );

  expect(outcome.status).toBe("rejected");
  expect(instance.scripts.length).toBe(before);
});

test("artwork: 허용 URL도 매 redirect를 검사해 외부 호스트로 요청하지 않아요", async () => {
  const requested: string[] = [];
  const instance = await fixture({
    fetch: async (url, init) => {
      requested.push(url);
      expect(init.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  });

  const result = await instance.provider.artwork.fetch(
    {
      providerId: "apple-music",
      artworkId: rawTrack.artworkUrl100,
    },
    signal,
  );

  expect(result.ok).toBe(false);
  expect(requested).toEqual([rawTrack.artworkUrl100]);
});

test("artwork: 허용 redirect의 이미지 바이트만 캐시하고 외부 URL을 노출하지 않아요", async () => {
  const requested: string[] = [];
  const instance = await fixture({
    fetch: async (url) => {
      requested.push(url);
      return requested.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "/image/final.jpg" },
          })
        : new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/jpeg" },
          });
    },
  });
  const artwork = {
    providerId: "apple-music",
    artworkId: rawTrack.artworkUrl100,
  };

  const first = value(await instance.provider.artwork.fetch(artwork, signal));
  new Uint8Array(first.body)[0] = 9;
  const cached = value(await instance.provider.artwork.fetch(artwork, signal));

  expect(Array.from(new Uint8Array(cached.body))).toEqual([1, 2, 3]);
  expect(cached.contentType).toBe("image/jpeg");
  expect(requested.length).toBe(2);
});

test("카탈로그: rate limit의 명시된 재시도 시간만 반환해요", async () => {
  const instance = await fixture({
    fetch: async () =>
      new Response(null, {
        status: 429,
        headers: { "retry-after": "12" },
      }),
  });

  expect(await instance.provider.catalog.lookup(ref, signal)).toEqual({
    ok: false,
    error: { code: "rate-limited", retryAfterSec: 12 },
  });
});

test("관측 취소: 마지막 구독을 닫으면 진행 중인 native 읽기도 취소해요", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const instance = await fixture({
    runScript: async (script, requestSignal) => {
      if (script.startsWith("-- jukebox:connect")) {
        return "stopped";
      }
      return new Promise<string>((_resolve, reject) => {
        requestSignal.addEventListener(
          "abort",
          () => reject(requestSignal.reason),
          { once: true },
        );
        started.resolve(requestSignal);
      });
    },
  });
  await instance.connect();
  const controller = new AbortController();
  const iterator = instance.runtime.playback.observe(controller.signal);
  const pending = iterator.next();
  const nativeSignal = await started.promise;

  controller.abort();

  expect(await pending).toEqual({ done: true, value: undefined });
  expect(nativeSignal.aborted).toBe(true);
});

test("stop 실패: 실제 정지를 확인하지 못하면 stopped나 ended를 반환하지 않아요", async () => {
  const instance = await fixture({
    runScript: async (script) => {
      if (script.startsWith("-- jukebox:connect")) {
        return "playing";
      }
      if (script.startsWith("-- jukebox:control")) {
        throw new Error("결과 불명");
      }
      return encoded(nativeTrack);
    },
  });
  await instance.connect();
  await instance.play();
  const iterator = instance.runtime.playback.observe(signal);
  await iterator.next();

  const outcome = await instance.runtime.playback.execute(
    {
      type: "stop",
      context: { ...instance.context, commandId: "stop-1" },
    },
    signal,
  );

  expect(outcome.status).toBe("unknown");
  expect((await instance.tick(iterator)).state).toBe("unknown");
});

test("카탈로그 취소: fetch 완료가 늦어도 취소를 정상 결과로 바꾸지 않아요", async () => {
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const instance = await fixture({
    fetch: async () => {
      started.resolve();
      return response.promise;
    },
  });
  const controller = new AbortController();
  const pending = instance.provider.catalog.lookup(ref, controller.signal);
  await started.promise;

  controller.abort(new Error("조회 취소"));
  response.resolve(Response.json({ results: [rawTrack] }));

  await expect(pending).rejects.toThrow("조회 취소");
});

test("artwork: 최초 URL과 마지막 응답의 이미지 형식을 검증해요", async () => {
  const instance = await fixture({
    fetch: async () =>
      new Response("<html>비밀</html>", {
        headers: { "content-type": "text/html" },
      }),
  });

  for (const artworkId of [
    "https://evil.example/x",
    "https://mzstatic.com.evil.example/x",
    "http://is1.mzstatic.com/x",
    "https://user:password@is1.mzstatic.com/x",
    "https://is1.mzstatic.com:8443/x",
  ]) {
    expect(
      await instance.provider.artwork.fetch(
        {
          providerId: "apple-music",
          artworkId,
        },
        signal,
      ),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
  }
  expect(
    await instance.provider.artwork.fetch(
      {
        providerId: "apple-music",
        artworkId: rawTrack.artworkUrl100,
      },
      signal,
    ),
  ).toEqual({ ok: false, error: { code: "unplayable" } });
});

test("dispose: 반복 정리 뒤 모든 외부 접근은 거절해요", async () => {
  const instance = await fixture();
  await instance.connect();
  await instance.provider.catalog.lookup(ref, signal);
  const before = instance.scripts.length;

  await instance.provider.dispose();
  await instance.provider.dispose();

  expect(await instance.provider.catalog.lookup(ref, signal)).toEqual({
    ok: false,
    error: { code: "disconnected" },
  });
  expect(
    await instance.runtime.playback.execute(
      {
        type: "stop",
        context: instance.context,
      },
      signal,
    ),
  ).toEqual({
    status: "rejected",
    context: instance.context,
    error: { code: "disconnected" },
  });
  expect(instance.scripts.length).toBe(before);
});
