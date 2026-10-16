import { expect, test } from "bun:test";
import { composeState } from "../shared/state-view";
import { FakePlayer, fixture, song, state } from "./test-support";

const settings = {
  read: () => ({
    requestsPaused: false,
    notice: "",
    maxPerDevice: 1,
    maxPerTable: 5,
  }),
};

test("일시정지는 접수가 아니라 실제 관측 뒤 공개 상태에 반영해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  player.autoObserve = false;

  await playback.pause();
  expect(composeState(f.queue, settings, "").nowPlaying?.status).toBe(
    "playing",
  );
  const paused = state(f.queue, (s) => s.nowPlaying?.status === "paused");
  player.deliver(player.current);
  await paused;

  expect(composeState(f.queue, settings, "").nowPlaying?.status).toBe("paused");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
});

test("연속 일시정지와 재개는 순서를 지키며 마지막 관측만 반영해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  const progressed = state(f.queue, (s) => s.nowPlaying?.positionSec === 50);
  player.report({ positionSec: 50 });
  await progressed;

  await Promise.all([playback.pause(), playback.resume()]);
  await state(f.queue, (s) => s.nowPlaying?.status === "playing");

  expect(player.calls.map((c) => c.type)).toEqual(["play", "pause", "resume"]);
  expect(f.queue.snapshot().nowPlaying?.positionSec).toBe(50);
  expect(await f.repo.loadHistory()).toEqual([]);
});

for (const action of ["pause", "resume"] as const) {
  test(`${action} 실패는 성공으로 표시하지 않고 현재 신청을 보존해요`, async () => {
    await using f = await fixture();
    await f.queue.enqueue(song("a"));
    const player = new FakePlayer();
    const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    const { playback } = f.start(player);
    await playing;
    player.outcome = "rejected";

    await expect(playback[action]()).rejects.toThrow("disconnected");

    expect(f.queue.snapshot().nowPlaying?.status).toBe("waiting");
    expect(f.queue.nowPlayingSong()?.id).toBe("a");
    expect(await f.repo.loadHistory()).toEqual([]);
  });
}

test("현재 곡이 없으면 제어는 외부 명령을 보내지 않아요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const { playback } = f.start(player);

  await Promise.all([
    playback.previous(),
    playback.pause(),
    playback.resume(),
    playback.skip(),
  ]);

  expect(player.calls).toEqual([]);
});

test("끝 위치의 일시정지와 길이 경과는 자연 종료의 증거가 아니에요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  const paused = state(f.queue, (s) => s.nowPlaying?.status === "paused");
  player.report({ positionSec: 199.99 }, "paused");
  await paused;

  const resumed = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  await playback.resume();
  await resumed;

  expect(player.calls.map((c) => c.type)).toEqual(["play", "resume"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect((await f.repo.loadQueue()).map((s) => s.id)).toEqual(["b"]);
});

test("재생 준비 중 일시정지는 준비 명령이 끝난 뒤 실행해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  player.beforeExecute = async (command) => {
    if (command.type !== "play") return;
    entered.resolve();
    await release.promise;
  };
  const { playback } = f.start(player);
  await entered.promise;

  const paused = state(f.queue, (s) => s.nowPlaying?.status === "paused");
  const pausing = playback.pause();
  expect(player.calls.map((c) => c.type)).toEqual(["play"]);
  release.resolve();
  await pausing;
  await paused;

  expect(player.calls.map((c) => c.type)).toEqual(["play", "pause"]);
  expect(await f.repo.loadHistory()).toEqual([]);
});
