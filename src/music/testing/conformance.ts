import { describe, expect, test } from "bun:test";
import type {
  BrowserMusicProvider,
  MusicResult,
  PlaybackCapabilities,
  PlaybackContext,
  PlaybackObservation,
  PlaybackRuntime,
  ProviderDescriptor,
  ServerMusicProvider,
  TrackRef,
} from "../contracts/index";

export interface ProviderContractFixture {
  readonly descriptor: ProviderDescriptor;
  readonly provider: ServerMusicProvider;
  readonly browser?: BrowserMusicProvider;
  readonly runtime: PlaybackRuntime;
  readonly trackRef: TrackRef;
  readonly query: string;
  flushObservations(): void;
}

// 제품 registry가 아닌 테스트용 계약 검사예요. 실제 조립 검증은 앱에서 구현해요.
export function assertProviderRegistration(
  descriptor: ProviderDescriptor,
  server: ServerMusicProvider,
  browser?: BrowserMusicProvider,
) {
  expect(descriptor.providerId.length).toBeGreaterThan(0);
  expect(descriptor.modes.length).toBeGreaterThan(0);
  expect(new Set(descriptor.modes.map((mode) => mode.modeId)).size).toBe(
    descriptor.modes.length,
  );
  expect(server.identity.providerId).toBe(descriptor.providerId);
  const mode = descriptor.modes.find(
    (mode) => mode.modeId === server.identity.modeId,
  );
  expect(mode).toBeDefined();
  expect(mode?.modeId.length).toBeGreaterThan(0);
  expect(mode?.location).toBe(server.execution.location);
  if (server.execution.location === "browser") {
    expect(browser?.identity).toEqual(server.identity);
  } else {
    expect(browser).toBeUndefined();
  }
}

export function assertJukeboxCapabilities(capabilities: PlaybackCapabilities) {
  for (const key of [
    "canPlayExactTrack",
    "canPause",
    "canResume",
    "canStop",
    "canRestart",
    "canObserveEnd",
  ] as const) {
    expect(capabilities[key], key).toBe(true);
  }
}

export function unwrapMusicResult<T>(result: MusicResult<T>): T {
  if (!result.ok) {
    throw new Error(`음악 작업 실패: ${result.error.code}`);
  }
  return result.value;
}

export async function readPlaybackObservation(
  iterator: AsyncIterator<PlaybackObservation, undefined>,
): Promise<PlaybackObservation> {
  const result = await iterator.next();
  if (result.done) {
    throw new Error("예상한 관측 전에 구독이 끝났어요");
  }
  return result.value;
}

async function disposeFixture(fixture: ProviderContractFixture) {
  try {
    await fixture.browser?.dispose();
  } finally {
    await fixture.provider.dispose();
  }
}

// 앱 큐/저장소를 대신하지 않아요. 공급자 경계의 동일 시나리오만 재사용해요.
export function defineProviderContractTests(
  name: string,
  createFixture: () =>
    | ProviderContractFixture
    | Promise<ProviderContractFixture>,
) {
  describe(name, () => {
    test("검색과 조회는 페이지를 따라 같은 문자열 곡 식별자를 보존해요", async () => {
      const fixture = await createFixture();
      const signal = new AbortController().signal;
      try {
        let page = unwrapMusicResult(
          await fixture.provider.catalog.search(fixture.query, null, signal),
        );
        const tracks = [...page.tracks];
        const seenCursors = new Set<string>();
        while (page.nextCursor !== null) {
          expect(seenCursors.size).toBeLessThan(100);
          expect(seenCursors.has(page.nextCursor)).toBe(false);
          seenCursors.add(page.nextCursor);
          page = unwrapMusicResult(
            await fixture.provider.catalog.search(
              fixture.query,
              page.nextCursor,
              signal,
            ),
          );
          tracks.push(...page.tracks);
        }
        const track = unwrapMusicResult(
          await fixture.provider.catalog.lookup(fixture.trackRef, signal),
        );

        expect(tracks).toContainEqual(track);
        expect(track.ref).toEqual(fixture.trackRef);
        expect(
          track.durationSec === null ||
            (Number.isFinite(track.durationSec) && track.durationSec >= 0),
        ).toBe(true);
      } finally {
        await disposeFixture(fixture);
      }
    }, 2000);

    test("연결과 재생은 접수 응답과 관측을 구분하고 재시작을 지원해요", async () => {
      const fixture = await createFixture();
      const abort = new AbortController();
      const { provider, runtime } = fixture;
      try {
        assertProviderRegistration(
          fixture.descriptor,
          provider,
          fixture.browser,
        );
        expect(
          unwrapMusicResult(await provider.auth.connect(abort.signal)).status,
        ).toBe("authorized");
        if (fixture.browser) {
          expect(
            unwrapMusicResult(await fixture.browser.auth.connect(abort.signal))
              .status,
          ).toBe("authorized");
        }
        const targets = unwrapMusicResult(
          await runtime.connection.listTargets(abort.signal),
        );
        expect(targets.length).toBeGreaterThan(0);
        const connected = unwrapMusicResult(
          await runtime.connection.connect(targets[0]!.ref, abort.signal),
        );
        assertJukeboxCapabilities(connected.capabilities);
        expect(connected.target).toMatchObject(provider.identity);
        expect(connected.location).toBe(provider.execution.location);
        const context: PlaybackContext = {
          commandId: "play:1",
          attemptId: "attempt:1",
          executorSessionId: "executor:1",
          target: connected.target,
          connectionGeneration: connected.connectionGeneration,
        };
        const iterator = runtime.playback.observe(abort.signal);
        expect((await readPlaybackObservation(iterator)).state).not.toBe(
          "playing",
        );
        let hasObservedPlay = false;
        const playing = iterator.next();
        void playing.then(() => {
          hasObservedPlay = true;
        });

        const accepted = await runtime.playback.execute(
          {
            type: "play",
            trackRef: fixture.trackRef,
            initialState: "playing",
            context,
          },
          abort.signal,
        );

        expect(accepted).toEqual({ status: "accepted", context });
        expect(hasObservedPlay).toBe(false);
        fixture.flushObservations();
        const startedResult = await playing;
        expect(startedResult.done).toBe(false);
        const started = startedResult.value!;
        expect(started.state).toBe("playing");
        expect(started.trackRef).toEqual(fixture.trackRef);
        expect(started.correlation).toEqual({
          commandId: context.commandId,
          attemptId: context.attemptId,
          executorSessionId: context.executorSessionId,
        });
        expect(started.binding).not.toBeNull();
        expect(
          unwrapMusicResult(
            await runtime.playback.reconcile(started.binding!, abort.signal),
          ).status,
        ).toBe("match");

        const paused = readPlaybackObservation(iterator);
        expect(
          (
            await runtime.playback.execute(
              { type: "pause", context: { ...context, commandId: "pause:1" } },
              abort.signal,
            )
          ).status,
        ).toBe("accepted");
        fixture.flushObservations();
        expect((await paused).state).toBe("paused");

        const restarted = readPlaybackObservation(iterator);
        const restartedContext = {
          ...context,
          commandId: "restart:1",
          attemptId: "attempt:2",
        };
        expect(
          (
            await runtime.playback.execute(
              {
                type: "restart",
                initialState: "paused",
                context: restartedContext,
              },
              abort.signal,
            )
          ).status,
        ).toBe("accepted");
        fixture.flushObservations();
        const restart = await restarted;
        expect(restart.state).toBe("paused");
        expect(restart.positionSec).toBe(0);
        expect(restart.trackRef).toEqual(fixture.trackRef);
        expect(restart.correlation?.attemptId).toBe("attempt:2");

        const resumed = readPlaybackObservation(iterator);
        expect(
          (
            await runtime.playback.execute(
              {
                type: "resume",
                context: { ...restartedContext, commandId: "resume:1" },
              },
              abort.signal,
            )
          ).status,
        ).toBe("accepted");
        fixture.flushObservations();
        expect((await resumed).state).toBe("playing");

        const stopped = readPlaybackObservation(iterator);
        expect(
          (
            await runtime.playback.execute(
              {
                type: "stop",
                context: { ...restartedContext, commandId: "stop:1" },
              },
              abort.signal,
            )
          ).status,
        ).toBe("accepted");
        fixture.flushObservations();
        const stop = await stopped;
        expect(stop.state).not.toBe("ended");
        expect(stop.state).not.toBe("playing");
      } finally {
        abort.abort();
        await disposeFixture(fixture);
      }
    }, 2000);

    test("관측 중단은 대기 중 읽기와 버퍼를 끝내고 다른 구독은 보존해요", async () => {
      const fixture = await createFixture();
      const firstAbort = new AbortController();
      const secondAbort = new AbortController();
      try {
        const first = fixture.runtime.playback.observe(firstAbort.signal);
        const second = fixture.runtime.playback.observe(secondAbort.signal);
        await first.next();
        await second.next();
        const pendingFirst = first.next();

        firstAbort.abort();

        expect((await pendingFirst).done).toBe(true);
        expect((await first.next()).done).toBe(true);
        const pendingSecond = second.next();
        unwrapMusicResult(
          await fixture.runtime.connection.disconnect(secondAbort.signal),
        );
        expect((await pendingSecond).done).toBe(false);
        const pendingReturn = second.next();
        await second.return?.();
        expect((await pendingReturn).done).toBe(true);
      } finally {
        firstAbort.abort();
        secondAbort.abort();
        await disposeFixture(fixture);
      }
    }, 2000);

    test("dispose는 대기 관측을 닫고 이후 작업을 연결 해제로 거절해요", async () => {
      const fixture = await createFixture();
      const signal = new AbortController().signal;
      try {
        const iterator = fixture.runtime.playback.observe(signal);
        await iterator.next();
        const pending = iterator.next();

        await disposeFixture(fixture);

        expect((await pending).done).toBe(true);
        expect(
          (await fixture.runtime.playback.observe(signal).next()).done,
        ).toBe(true);
        expect(
          await fixture.provider.catalog.lookup(fixture.trackRef, signal),
        ).toEqual({
          ok: false,
          error: { code: "disconnected" },
        });
        expect(await fixture.runtime.connection.listTargets(signal)).toEqual({
          ok: false,
          error: { code: "disconnected" },
        });
        await disposeFixture(fixture);
      } finally {
        await disposeFixture(fixture);
      }
    }, 2000);
  });
}
