import { expect, test } from "bun:test";
import type { PlaybackObservation } from "../../music/contracts";
import { connection, FakePlayer, fixture, song, state } from "./test-support";

test("재시작 뒤 오래된 시도의 종료는 같은 신청곡도 완료하지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  const stale: PlaybackObservation = {
    ...player.current,
    sequence: 100,
    state: "ended",
    endReason: "natural-end",
  };

  await playback.previous();
  player.deliver(stale);
  const current = state(f.queue, (s) => s.nowPlaying?.positionSec === 1);
  player.report({ positionSec: 1 });
  await current;

  expect(player.calls.map((c) => c.type)).toEqual(["play", "restart"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
});

test("일시정지 전 명령의 종료 관측은 현재 곡을 완료하지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  const stale: PlaybackObservation = {
    ...player.current,
    sequence: 100,
    state: "ended",
    endReason: "natural-end",
  };
  await playback.pause();

  player.deliver(stale);
  const current = state(f.queue, (s) => s.nowPlaying?.positionSec === 1);
  player.report({ positionSec: 1 }, "paused");
  await current;

  expect(f.queue.snapshot().nowPlaying?.status).toBe("paused");
  expect(player.calls.map((c) => c.type)).toEqual(["play", "pause"]);
  expect(await f.repo.loadHistory()).toEqual([]);
});

for (const mismatch of [
  "attempt",
  "session",
  "connection",
  "target",
  "track",
  "sequence",
] as const) {
  test(`${mismatch} 불일치 관측은 종료나 다음 곡 재생을 만들지 않아요`, async () => {
    await using f = await fixture();
    await f.queue.enqueue(song("a"));
    await f.queue.enqueue(song("b"));
    const player = new FakePlayer();
    const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    f.start(player);
    await playing;
    const original = player.current;
    const ended: PlaybackObservation = {
      ...original,
      sequence:
        mismatch === "sequence" ? original.sequence : original.sequence + 1,
      state: "ended",
      endReason: "natural-end",
      correlation: {
        ...original.correlation!,
        ...(mismatch === "attempt" ? { attemptId: "old-attempt" } : {}),
        ...(mismatch === "session"
          ? { executorSessionId: "other-session" }
          : {}),
      },
      connectionGeneration:
        mismatch === "connection"
          ? "old-generation"
          : original.connectionGeneration,
      target:
        mismatch === "target"
          ? { ...connection.target, targetId: "other-output" }
          : original.target,
      trackRef:
        mismatch === "track"
          ? { ...song("a").ref, trackId: "other-track" }
          : original.trackRef,
    };

    player.deliver(ended);
    const current = state(f.queue, (s) => s.nowPlaying?.positionSec === 2);
    // 잘못된 track 관측도 같은 연결 순서를 소비하므로 더 새 snapshot으로 확인해요.
    player.report({ positionSec: 1 });
    player.report({ positionSec: 2 });
    await current;

    expect(player.calls.map((c) => c.type)).toEqual(["play"]);
    expect(f.queue.nowPlayingSong()?.id).toBe("a");
    expect(await f.repo.loadHistory()).toEqual([]);
  });
}

test("정지 접수와 unknown 관측만으로 건너뛰기를 완료하지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  player.autoObserve = false;
  const accepted = Promise.withResolvers<void>();
  const execute = player.execute.bind(player);
  player.execute = async (...args) => {
    const result = await execute(...args);
    accepted.resolve();
    return result;
  };

  const skipping = playback.skip();
  await accepted.promise;
  const unknown = {
    ...player.current,
    state: "unknown" as const,
    endReason: undefined,
  };
  player.deliver(unknown);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
  player.report({}, "stopped");
  await skipping;

  expect((await f.repo.loadHistory()).map((s) => s.id)).toEqual(["a"]);
});

test("정지 관측이 없으면 제한 시간 후 요청을 보존하고 제어를 실패시켜요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player, connection, undefined, 0);
  await playing;
  player.autoObserve = false;

  await expect(playback.skip()).rejects.toThrow("정지 확인 시간이 초과");

  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
});

test("unknown 관측은 빈 트랙이어도 정지 확인 시간 초과로 남아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player, connection, undefined, 0);
  await playing;
  const deliver = player.deliver.bind(player);
  player.deliver = (observation) =>
    deliver(
      observation.state === "stopped"
        ? { ...observation, state: "unknown" }
        : observation,
    );

  await expect(playback.skip()).rejects.toThrow("정지 확인 시간이 초과");

  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
});

test("정지 확인 중 취소하면 구독과 제어 대기를 정확히 해제해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const abort = new AbortController();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback, running } = f.start(player, connection, abort.signal);
  await playing;
  player.autoObserve = false;
  const stop = player.called("stop");
  const skipping = playback.skip();
  void skipping.catch(() => undefined);
  await stop;

  abort.abort();
  await expect(skipping).rejects.toThrow();
  await running;
  await playback.dispose();
  await f.queue.enqueue(song("b"));

  expect(player.disposed).toBe(1);
  expect(player.subscribers).toBe(0);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop"]);
});

test("무관한 곡 변경은 재확인 상태로 보존하며 외부 곡을 멈추지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  f.start(player);
  await playing;
  const unknown = state(
    f.queue,
    (s) => s.nowPlaying?.status === "reconciliation-required",
  );

  player.report({ trackRef: null, binding: null }, "unknown");
  await unknown;

  expect(player.calls.map((c) => c.type)).toEqual(["play"]);
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
});

test("이미 취소된 시작은 구독이나 재생 없이 한 번만 정리해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const abort = new AbortController();
  abort.abort();

  const { playback, running } = f.start(player, connection, abort.signal);
  await running;
  await playback.dispose();

  expect(player.calls).toEqual([]);
  expect(player.subscribers).toBe(0);
  expect(player.disposed).toBe(1);
  expect((await f.repo.loadQueue()).map((s) => s.id)).toEqual(["a"]);
});
