import { expect, test } from "bun:test";
import type { PlaybackContext, TrackRef } from "../contracts/index";
import {
  assertJukeboxCapabilities,
  assertProviderRegistration,
  createContrastingProvider,
  createContrastingServer,
  defineProviderContractTests,
  readPlaybackObservation,
  unwrapMusicResult,
} from "./index";

const trackId = "Mix:Aa/_?한글";

defineProviderContractTests("서비스 권한 라디오", () => {
  const fixture = createContrastingProvider();
  return {
    ...fixture,
    trackRef: { providerId: fixture.provider.identity.providerId, trackId },
    query: "소리",
    flushObservations() {
      for (const sequence of fixture.controls.pendingSequences()) {
        fixture.controls.deliver(sequence);
      }
    },
  };
});

defineProviderContractTests("분리된 브라우저 실행", () => {
  const server = createContrastingProvider({ location: "browser" });
  const client = createContrastingProvider({ location: "browser" });
  return {
    descriptor: server.descriptor,
    provider: server.provider,
    browser: {
      identity: client.provider.identity,
      auth: client.provider.auth,
      runtime: client.runtime,
      dispose: () => client.provider.dispose(),
    },
    runtime: client.runtime,
    trackRef: { providerId: server.provider.identity.providerId, trackId },
    query: "소리",
    flushObservations() {
      for (const sequence of client.controls.pendingSequences()) {
        client.controls.deliver(sequence);
      }
    },
  };
});

async function connectedFixture(
  options: Parameters<typeof createContrastingProvider>[0] = {},
) {
  const fixture = createContrastingProvider(options);
  const signal = new AbortController().signal;
  unwrapMusicResult(await fixture.provider.auth.connect(signal));
  const targets = unwrapMusicResult(
    await fixture.runtime.connection.listTargets(signal),
  );
  const connection = unwrapMusicResult(
    await fixture.runtime.connection.connect(targets[0]!.ref, signal),
  );
  const context: PlaybackContext = {
    commandId: "play:1",
    attemptId: "attempt:1",
    executorSessionId: "executor:1",
    target: connection.target,
    connectionGeneration: connection.connectionGeneration,
  };
  const ref: TrackRef = {
    providerId: fixture.provider.identity.providerId,
    trackId,
  };
  return {
    ...fixture,
    signal,
    context,
    ref,
    async play() {
      return fixture.runtime.playback.execute(
        { type: "play", trackRef: ref, initialState: "playing", context },
        signal,
      );
    },
    [Symbol.asyncDispose]: () => fixture.provider.dispose(),
  };
}

test("카탈로그는 대소문자가 다른 불투명 ID와 길이 부재를 보존해요", async () => {
  await using fixture = await connectedFixture({
    providerId: "arbitrary-provider",
    modeId: "unlisted-mode",
  });

  const first = unwrapMusicResult(
    await fixture.provider.catalog.search("소리", null, fixture.signal),
  );
  const second = unwrapMusicResult(
    await fixture.provider.catalog.search(
      "소리",
      first.nextCursor,
      fixture.signal,
    ),
  );

  expect(first.tracks[0]?.ref).toEqual(fixture.ref);
  expect(first.tracks[0]?.durationSec).toBeNull();
  expect(second.tracks[0]?.ref.trackId).toBe("mix:aa/_?한글");
  expect(second.tracks[0]?.durationSec).toBe(98.5);
  expect(second.nextCursor).toBeNull();
  expect(fixture.provider.auth.getState()).toEqual({
    status: "authorized",
    authorization: "service",
    action: null,
  });
  expect(
    await fixture.provider.catalog.lookup(
      { ...fixture.ref, providerId: "other" },
      fixture.signal,
    ),
  ).toEqual({
    ok: false,
    error: { code: "invalid-track" },
  });
});

test.each([
  { id: trackId, title: "곡", artist: "가수", seconds: -1, kind: "audio" },
  {
    id: trackId,
    title: "곡",
    artist: "가수",
    seconds: Number.NaN,
    kind: "audio",
  },
  {
    id: trackId,
    title: "곡",
    artist: "가수",
    seconds: Number.POSITIVE_INFINITY,
    kind: "audio",
  },
  { id: trackId, title: "곡", artist: "가수", seconds: "3", kind: "audio" },
  { id: 10, title: "곡", artist: "가수", seconds: 3, kind: "audio" },
])(
  "카탈로그는 잘못된 공급자 응답을 정상 곡으로 노출하지 않아요: %j",
  async (row) => {
    await using fixture = await connectedFixture({ tracks: [row] });

    const result = await fixture.provider.catalog.search(
      "",
      null,
      fixture.signal,
    );

    expect(result).toEqual({ ok: false, error: { code: "invalid-track" } });
    expect(
      await fixture.provider.catalog.lookup(fixture.ref, fixture.signal),
    ).toEqual({
      ok: false,
      error: { code: "invalid-track" },
    });
  },
);

test("영상 결과와 잘못된 cursor는 오디오 성공 결과로 대체하지 않아요", async () => {
  await using fixture = await connectedFixture({
    tracks: [
      {
        id: trackId,
        title: "영상",
        artist: "가수",
        seconds: 30,
        kind: "video",
      },
    ],
  });
  await using valid = await connectedFixture();

  expect(
    await fixture.provider.catalog.lookup(fixture.ref, fixture.signal),
  ).toEqual({
    ok: false,
    error: { code: "unplayable" },
  });
  expect(await fixture.play()).toMatchObject({
    status: "rejected",
    error: { code: "unplayable" },
  });
  expect(
    await valid.provider.catalog.search("소리", "invented", valid.signal),
  ).toEqual({
    ok: false,
    error: { code: "configuration" },
  });
  expect(fixture.controls.pendingSequences()).toEqual([]);
});

test("재시작은 seek 없이 새 native binding으로 같은 곡을 다시 준비해요", async () => {
  await using fixture = await connectedFixture();
  await fixture.play();
  const iterator = fixture.runtime.playback.observe(fixture.signal);
  const started = await readPlaybackObservation(iterator);
  fixture.controls.advanceTo(40);
  for (const sequence of fixture.controls.pendingSequences()) {
    fixture.controls.deliver(sequence);
  }
  await iterator.next();
  const progressed = await readPlaybackObservation(iterator);
  expect(progressed.positionSec).toBe(40);

  const restarted = readPlaybackObservation(iterator);
  const outcome = await fixture.runtime.playback.execute(
    {
      type: "restart",
      initialState: "paused",
      context: {
        ...fixture.context,
        commandId: "restart:1",
        attemptId: "attempt:2",
      },
    },
    fixture.signal,
  );
  fixture.controls.deliver(fixture.controls.pendingSequences()[0]!);
  const snapshot = await restarted;

  expect(outcome.status).toBe("accepted");
  expect(snapshot).toMatchObject({
    state: "paused",
    positionSec: 0,
    trackRef: fixture.ref,
    durationSec: null,
  });
  expect(snapshot.binding).not.toEqual(started.binding);
  expect(snapshot.binding?.payload).toMatchObject({
    trackId,
    attemptId: "attempt:2",
  });
  expect(snapshot.binding?.payload).not.toMatchObject({ nativeId: trackId });
  expect(
    unwrapMusicResult(
      await fixture.runtime.playback.reconcile(
        started.binding!,
        fixture.signal,
      ),
    ).status,
  ).toBe("mismatch");
  expect(
    unwrapMusicResult(
      await fixture.runtime.playback.reconcile(
        snapshot.binding!,
        fixture.signal,
      ),
    ).status,
  ).toBe("match");
});

test("미지원 seek와 필수 pause는 성공 no-op 대신 거절하고 관측을 만들지 않아요", async () => {
  await using fixture = await connectedFixture({
    capabilities: { canPause: false },
  });
  await fixture.play();
  const pending = fixture.controls.pendingSequences();

  const seek = await fixture.runtime.playback.execute(
    {
      type: "seek",
      positionSec: 5,
      context: fixture.context,
    },
    fixture.signal,
  );
  const pause = await fixture.runtime.playback.execute(
    {
      type: "pause",
      context: fixture.context,
    },
    fixture.signal,
  );

  expect(seek).toMatchObject({
    status: "rejected",
    error: { code: "unsupported" },
  });
  expect(pause).toMatchObject({
    status: "rejected",
    error: { code: "unsupported" },
  });
  expect(fixture.controls.pendingSequences()).toEqual(pending);
  expect(() =>
    assertJukeboxCapabilities(fixture.descriptor.modes[0]!.capabilities),
  ).toThrow();
});

test("역순 관측은 이전 시도의 종료와 새 곡의 재생을 구분할 정보를 보존해요", async () => {
  await using fixture = await connectedFixture();
  const iterator = fixture.runtime.playback.observe(fixture.signal);
  await iterator.next();
  await fixture.play();
  fixture.controls.finishNaturally();
  const nextRef = { ...fixture.ref, trackId: "mix:aa/_?한글" };
  const nextContext = {
    ...fixture.context,
    commandId: "play:2",
    attemptId: "attempt:2",
  };
  await fixture.runtime.playback.execute(
    {
      type: "play",
      trackRef: nextRef,
      initialState: "playing",
      context: nextContext,
    },
    fixture.signal,
  );
  const [started, ended, next] = fixture.controls.pendingSequences();
  const waiting = readPlaybackObservation(iterator);

  fixture.controls.deliver(next!);
  fixture.controls.deliver(ended!);
  fixture.controls.deliver(started!);

  const current = await waiting;
  const lateEnd = await readPlaybackObservation(iterator);
  const lateStart = await readPlaybackObservation(iterator);
  expect(current).toMatchObject({
    state: "playing",
    trackRef: nextRef,
    correlation: { attemptId: "attempt:2" },
  });
  expect(lateEnd).toMatchObject({
    state: "ended",
    endReason: "natural-end",
    trackRef: fixture.ref,
    correlation: { attemptId: "attempt:1" },
  });
  expect(lateEnd.sequence).toBeLessThan(current.sequence);
  expect(lateStart.sequence).toBeLessThan(lateEnd.sequence);
  const reconnected = fixture.runtime.playback.observe(fixture.signal);
  expect(await readPlaybackObservation(reconnected)).toEqual(current);
});

test.each([false, true])(
  "적용 여부 불명 명령은 접수나 확정 실패로 바꾸지 않아요: 적용=%j",
  async (applies) => {
    await using fixture = await connectedFixture();
    const iterator = fixture.runtime.playback.observe(fixture.signal);
    await iterator.next();
    fixture.controls.setNextOutcome({ status: "unknown", applies });

    const result = await fixture.play();

    expect(result).toEqual({
      status: "unknown",
      context: fixture.context,
      error: { code: "unknown-outcome" },
    });
    expect(fixture.controls.pendingSequences()).toHaveLength(applies ? 1 : 0);
    const observed = fixture.runtime.playback.observe(fixture.signal);
    const snapshot = await readPlaybackObservation(observed);
    expect(snapshot.state).toBe(applies ? "playing" : "unknown");
  },
);

test("명령 거절은 재생을 적용하지 않고 원시 오류를 노출하지 않아요", async () => {
  await using fixture = await connectedFixture();
  fixture.controls.setNextOutcome({
    status: "rejected",
    code: "permission-denied",
  });

  const result = await fixture.play();

  expect(result).toEqual({
    status: "rejected",
    context: fixture.context,
    error: { code: "permission-denied" },
  });
  expect(fixture.controls.pendingSequences()).toEqual([]);
  expect(
    (
      await readPlaybackObservation(
        fixture.runtime.playback.observe(fixture.signal),
      )
    ).state,
  ).toBe("unknown");
});

test("선행 취소는 명령을 발행하지 않고 이미 취소된 관측도 즉시 끝내요", async () => {
  await using fixture = await connectedFixture();
  const abort = new AbortController();
  const reason = new Error("테스트 취소");
  abort.abort(reason);

  await expect(
    fixture.runtime.playback.execute(
      {
        type: "play",
        trackRef: fixture.ref,
        initialState: "playing",
        context: fixture.context,
      },
      abort.signal,
    ),
  ).rejects.toBe(reason);

  expect(fixture.controls.pendingSequences()).toEqual([]);
  expect(
    (await fixture.runtime.playback.observe(abort.signal).next()).done,
  ).toBe(true);
  expect(fixture.controls.subscriberCount).toBe(0);
  await expect(
    fixture.provider.catalog.lookup(fixture.ref, abort.signal),
  ).rejects.toBe(reason);
  await expect(fixture.provider.auth.connect(abort.signal)).rejects.toBe(
    reason,
  );
  await expect(
    fixture.runtime.connection.listTargets(abort.signal),
  ).rejects.toBe(reason);
});

test("취소와 dispose는 버퍼와 리스너를 없애고 늦은 관측을 전달하지 않아요", async () => {
  await using fixture = await connectedFixture();
  const abort = new AbortController();
  const iterator = fixture.runtime.playback.observe(abort.signal);
  await iterator.next();
  await fixture.play();
  fixture.controls.deliver(fixture.controls.pendingSequences()[0]!);

  abort.abort();

  expect((await iterator.next()).done).toBe(true);
  expect(fixture.controls.subscriberCount).toBe(0);
  const active = fixture.runtime.playback.observe(fixture.signal);
  await active.next();
  const pending = active.next();
  await fixture.runtime.playback.dispose();
  expect((await pending).done).toBe(true);
  expect(fixture.controls.subscriberCount).toBe(0);
  expect(fixture.controls.pendingSequences()).toEqual([]);
  expect(await fixture.play()).toMatchObject({
    status: "rejected",
    error: { code: "disconnected" },
  });
});

test("재연결은 연결 세대를 바꾸고 이전 명령과 불확실한 binding을 거절해요", async () => {
  await using fixture = await connectedFixture();
  await fixture.play();
  const first = await readPlaybackObservation(
    fixture.runtime.playback.observe(fixture.signal),
  );

  const connection = unwrapMusicResult(
    await fixture.runtime.connection.connect(
      fixture.context.target,
      fixture.signal,
    ),
  );

  expect(connection.connectionGeneration).not.toBe(
    fixture.context.connectionGeneration,
  );
  expect(await fixture.play()).toMatchObject({
    status: "rejected",
    error: { code: "disconnected" },
  });
  expect(
    unwrapMusicResult(
      await fixture.runtime.playback.reconcile(first.binding!, fixture.signal),
    ).status,
  ).toBe("unknown");
  expect(
    unwrapMusicResult(
      await fixture.runtime.playback.reconcile(
        {
          providerId: fixture.ref.providerId,
          modeId: fixture.provider.identity.modeId,
          version: 999,
          payload: null,
        },
        fixture.signal,
      ),
    ).status,
  ).toBe("unknown");
});

test("factory와 등록 검증은 열린 ID를 허용하되 잘못된 조합을 거절해요", async () => {
  await using fixture = await connectedFixture();
  const signal = fixture.signal;
  const result = await createContrastingServer(
    {
      providerId: "new-provider",
      modeId: "new-mode",
      pageSize: 2,
    },
    signal,
  );
  const provider = unwrapMusicResult(result);
  try {
    expect(provider.identity).toEqual({
      providerId: "new-provider",
      modeId: "new-mode",
    });
    expect(() =>
      assertProviderRegistration(fixture.descriptor, provider),
    ).toThrow();
    expect(() =>
      assertProviderRegistration(
        {
          ...fixture.descriptor,
          modes: [],
        },
        fixture.provider,
      ),
    ).toThrow();
    expect(() =>
      assertProviderRegistration(
        {
          ...fixture.descriptor,
          modes: [...fixture.descriptor.modes, ...fixture.descriptor.modes],
        },
        fixture.provider,
      ),
    ).toThrow();
    expect(await createContrastingServer({ pageSize: 0 }, signal)).toEqual({
      ok: false,
      error: { code: "configuration" },
    });
  } finally {
    await provider.dispose();
  }
});
