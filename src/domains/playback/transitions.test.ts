import { expect, test } from "bun:test";
import { PlaybackService } from "./playback.service";
import { FakePlayer, fixture, seedHistory, song } from "./test-support";

test("이전으로 재시작한 곡은 예전 종료 위치나 벽시계 마감으로 끝나지 않아요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  player.positionSec = 199.99;
  const reading = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<number>();
  const observed = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<void>();
  const abort = new AbortController();
  let reads = 0;
  player.position = async () => {
    if (++reads === 1) {
      reading.resolve();
      return stale.promise;
    }
    return player.positionSec;
  };
  player.sleep = async () => {
    observed.resolve();
    await exit.promise;
  };
  const playback = new PlaybackService(f.queue, player);

  const running = playback.start(abort.signal);
  await reading.promise;
  await playback.previous();
  player.clock = 24 * 60 * 60 * 1000;
  stale.resolve(199.99);
  await observed.promise;
  abort.abort();
  exit.resolve();
  await running;

  expect(player.calls).toEqual(["restart"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(f.queue.snapshot().nowPlaying?.positionSec).toBe(0);
  expect(await f.repo.loadHistory()).toEqual([]);
});

test("이전 신청곡으로 이동하면 예전 트랙 관측이 새 곡을 멈추지 않아요", async () => {
  using f = await fixture();
  await seedHistory(f.queue);
  const player = new FakePlayer();
  const reading = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<"stopped">();
  const observed = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<void>();
  const abort = new AbortController();
  let reads = 0;
  player.playerState = async () => {
    if (++reads === 1) {
      reading.resolve();
      return stale.promise;
    }
    return player.state;
  };
  player.sleep = async () => {
    observed.resolve();
    await exit.promise;
  };
  const playback = new PlaybackService(f.queue, player);

  const running = playback.start(abort.signal);
  await reading.promise;
  await playback.previous();
  stale.resolve("stopped");
  await observed.promise;
  abort.abort();
  exit.resolve();
  await running;

  expect(player.calls).toEqual(["play:a"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([song("z")]);
  expect(await f.repo.loadQueue()).toEqual([song("b"), song("c")]);
});

test("일시정지 전 시작된 정지 관측은 현재 곡을 완료하지 않아요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  const reading = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<"stopped">();
  const observed = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<void>();
  const abort = new AbortController();
  let reads = 0;
  player.playerState = async () => {
    if (++reads === 1) {
      reading.resolve();
      return stale.promise;
    }
    return player.state;
  };
  player.sleep = async () => {
    observed.resolve();
    await exit.promise;
  };
  const playback = new PlaybackService(f.queue, player);

  const running = playback.start(abort.signal);
  await reading.promise;
  await playback.pause();
  stale.resolve("stopped");
  await observed.promise;
  abort.abort();
  exit.resolve();
  await running;

  expect(f.queue.snapshot().nowPlaying?.status).toBe("paused");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect(player.calls).toEqual(["pause"]);
});

test("건너뛰기 저장 실패 후 루프가 정지 관측을 성공 완료로 덮어쓰지 않아요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  await f.queue.takeAndStart();
  await f.client.execute(
    "CREATE TRIGGER fail_skip BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '실패'); END",
  );
  const player = new FakePlayer();
  const reading = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<"stopped">();
  const suspended = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<void>();
  const abort = new AbortController();
  player.playerState = async () => {
    reading.resolve();
    return stale.promise;
  };
  player.sleep = async () => {
    suspended.resolve();
    await exit.promise;
  };
  const playback = new PlaybackService(f.queue, player);

  const running = playback.start(abort.signal);
  await reading.promise;
  await expect(playback.skip()).rejects.toThrow();
  await f.client.execute("DROP TRIGGER fail_skip");
  stale.resolve("stopped");
  await suspended.promise;
  abort.abort();
  exit.resolve();
  await running;

  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect(await f.repo.loadQueue()).toEqual([song("b")]);
  expect(player.calls).toEqual(["stop"]);
});

test("앨범이 자동 진행하면 다음 앨범곡을 멈추고 신청곡만 완료해요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  const abort = new AbortController();
  let reads = 0;
  player.currentTrackId = async () => ++reads;
  const stop = player.stop.bind(player);
  player.stop = async () => {
    await stop();
    abort.abort();
  };

  await new PlaybackService(f.queue, player).start(abort.signal);

  expect(player.calls).toEqual(["stop"]);
  expect(f.queue.nowPlayingSong()).toBeNull();
  expect(await f.repo.loadHistory()).toEqual([song("a")]);
});
