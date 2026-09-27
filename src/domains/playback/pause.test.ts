import { expect, test } from "bun:test";
import { composeState } from "../shared/state-view";
import { PlaybackService } from "./playback.service";
import { FakePlayer, fixture, song } from "./test-support";

const settings = {
  read: () => ({
    requestsPaused: false,
    notice: "",
    maxPerDevice: 1,
    maxPerTable: 5,
  }),
};

test("일시정지는 실제 플레이어와 공개 스냅샷에 반영해요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();

  await new PlaybackService(f.queue, player).pause();

  expect(player.state).toBe("paused");
  expect(composeState(f.queue, settings, "").nowPlaying?.status).toBe("paused");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
});

test("연속 일시정지·재개는 요청 순서대로 실행하고 현재 곡을 유지해요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  player.positionSec = 50;
  const playback = new PlaybackService(f.queue, player);

  await Promise.all([playback.pause(), playback.resume()]);

  expect(player.calls).toEqual(["pause", "resume"]);
  expect(player.state).toBe("playing");
  expect(player.positionSec).toBe(50);
  expect(composeState(f.queue, settings, "").nowPlaying?.status).toBe(
    "playing",
  );
});

for (const action of ["pause", "resume"] as const) {
  test(`${action} 명령 실패는 성공 상태로 노출하지 않아요`, async () => {
    using f = await fixture();
    await f.queue.enqueue(song("a"));
    await f.queue.takeAndStart();
    const player = new FakePlayer();
    const initial = action === "pause" ? "playing" : "paused";
    player.state = initial;
    f.queue.updatePlaybackStatus(initial, "a");
    player[action] = async () => {
      throw new Error("명령 실패");
    };
    const before = f.queue.snapshot();

    await expect(
      new PlaybackService(f.queue, player)[action](),
    ).rejects.toThrow();

    expect(f.queue.snapshot()).toEqual(before);
    expect(player.state).toBe(initial);
  });
}

test("현재 곡이 없으면 모든 제어는 Music.app을 건드리지 않아요", async () => {
  using f = await fixture();
  const player = new FakePlayer();
  const playback = new PlaybackService(f.queue, player);

  await Promise.all([
    playback.previous(),
    playback.pause(),
    playback.resume(),
    playback.skip(),
  ]);

  expect(player.calls).toEqual([]);
  expect(f.queue.snapshot()).toEqual({
    nowPlaying: null,
    queue: [],
    history: [],
  });
});

test("곡 끝에서 오래 일시정지해도 자동 완료하지 않고 같은 곡을 재개해요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  player.positionSec = 199.99;
  const playback = new PlaybackService(f.queue, player);
  await playback.pause();
  const first = Promise.withResolvers<void>();
  const advance = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<void>();
  const abort = new AbortController();
  let polls = 0;
  player.sleep = async () => {
    if (++polls === 1) {
      first.resolve();
      await advance.promise;
    } else {
      second.resolve();
      await exit.promise;
    }
  };

  const running = playback.start(abort.signal);
  await first.promise;
  player.clock = 10 * 60 * 60 * 1000;
  advance.resolve();
  await second.promise;
  const paused = f.queue.snapshot();
  await playback.resume();
  abort.abort();
  exit.resolve();
  await running;

  expect(paused.nowPlaying?.status).toBe("paused");
  expect(paused.nowPlaying?.song.id).toBe("a");
  expect(player.calls).toEqual(["pause", "resume"]);
  expect(player.state).toBe("playing");
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect((await f.repo.loadQueue()).map((entry) => entry.id)).toEqual(["b"]);
});

test("재생 준비 도중 일시정지는 준비가 끝난 다음 실행해요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const preparing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const abort = new AbortController();
  const play = player.play.bind(player);
  player.play = async (entry) => {
    preparing.resolve();
    await release.promise;
    await play(entry);
  };
  const pause = player.pause.bind(player);
  player.pause = async () => {
    await pause();
    abort.abort();
  };
  const playback = new PlaybackService(f.queue, player);

  const running = playback.start(abort.signal);
  await preparing.promise;
  const pausing = playback.pause();
  release.resolve();
  await pausing;
  await running;

  expect(player.calls).toEqual(["play:a", "pause"]);
  expect(f.queue.snapshot().nowPlaying?.status).toBe("paused");
  expect(await f.repo.loadHistory()).toEqual([]);
});
