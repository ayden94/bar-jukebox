import { expect, test } from "bun:test";
import { FakePlayer, fixture, seedHistory, song, state } from "./test-support";

for (const position of [3, 100]) {
  test(`${position}초에서 이전은 새 시도로 현재 신청곡을 재시작해요`, async () => {
    await using f = await fixture();
    await seedHistory(f.queue);
    const player = new FakePlayer();
    const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    const { playback } = f.start(player);
    await playing;
    const progressed = state(
      f.queue,
      (s) => s.nowPlaying?.positionSec === position,
    );
    player.report({ positionSec: position });
    await progressed;
    const before = f.queue.snapshot();
    const firstAttempt = player.calls[0]!.context.attemptId;

    const restarted = state(f.queue, (s) => s.nowPlaying?.positionSec === 0);
    await playback.previous();
    await restarted;

    expect(player.calls.map((c) => c.type)).toEqual(["play", "restart"]);
    expect(player.calls[1]!.context.attemptId).not.toBe(firstAttempt);
    expect(f.queue.nowPlayingSong()?.id).toBe("b");
    expect(f.queue.snapshot().queue).toEqual(before.queue);
    expect(await f.repo.loadHistory()).toEqual(before.history);
    expect((await f.repo.loadNowPlaying())?.startedAt).toBe(
      f.queue.snapshot().nowPlaying?.startedAt,
    );
  });
}

test("실제 위치 2.99초는 UI의 반올림된 3초와 달리 이전 신청곡으로 돌아가요", async () => {
  await using f = await fixture();
  await seedHistory(f.queue);
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  const progressed = state(f.queue, (s) => s.nowPlaying?.positionSec === 3);
  player.report({ positionSec: 2.99 });
  await progressed;

  await playback.previous();
  await state(f.queue, (s) => s.nowPlaying?.status === "playing");

  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop", "play"]);
  expect(f.queue.nowPlayingSong()).toEqual(song("a"));
  expect((await f.repo.loadNowPlaying())?.song).toEqual(song("a"));
  expect(await f.repo.loadQueue()).toEqual([song("b"), song("c")]);
  expect(await f.repo.loadHistory()).toEqual([song("z")]);
  expect(
    (
      await f.client.execute("SELECT position FROM queue ORDER BY position")
    ).rows.map((row) => row.position),
  ).toEqual([0, 1]);
});

test("히스토리가 없으면 3초 미만에서도 현재 곡을 재시작해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;

  await playback.previous();

  expect(player.calls.map((c) => c.type)).toEqual(["play", "restart"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadQueue()).toEqual([]);
});

for (const position of [0, 20]) {
  test(`일시정지 중 ${position}초의 이전은 처음부터 일시정지로 준비해요`, async () => {
    await using f = await fixture();
    await seedHistory(f.queue);
    const player = new FakePlayer();
    const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    const { playback } = f.start(player);
    await playing;
    const paused = state(f.queue, (s) => s.nowPlaying?.status === "paused");
    player.report({ positionSec: position }, "paused");
    await paused;

    await playback.previous();
    await state(f.queue, (s) => s.nowPlaying?.status === "paused");

    const command = player.calls.at(-1);
    expect(command?.type).toBe(position === 0 ? "play" : "restart");
    if (command?.type === "play" || command?.type === "restart") {
      expect(command.initialState).toBe("paused");
    }
    expect(f.queue.nowPlayingSong()?.id).toBe(position === 0 ? "a" : "b");
    expect(f.queue.snapshot().nowPlaying?.positionSec).toBe(0);
  });
}

for (const position of [0, 20]) {
  test(`이전 ${position}초의 저장 실패는 신청 목록을 유지하고 새 재생을 막아요`, async () => {
    await using f = await fixture();
    await seedHistory(f.queue);
    const player = new FakePlayer();
    const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    const { playback } = f.start(player);
    await playing;
    if (position !== 0) {
      const progressed = state(
        f.queue,
        (s) => s.nowPlaying?.positionSec === position,
      );
      player.report({ positionSec: position });
      await progressed;
    }
    const before = f.queue.snapshot();
    const stored = await f.repo.loadNowPlaying();
    await f.client.execute(
      "CREATE TRIGGER fail_previous BEFORE UPDATE ON now_playing BEGIN SELECT RAISE(ABORT, '실패'); END",
    );

    await expect(playback.previous()).rejects.toThrow();

    expect(player.calls.map((c) => c.type)).toEqual(
      position === 0 ? ["play", "stop"] : ["play"],
    );
    expect(await f.repo.loadNowPlaying()).toEqual(stored);
    expect(await f.repo.loadHistory()).toEqual(before.history);
    expect(await f.repo.loadQueue()).toEqual(before.queue);
    expect(f.queue.nowPlayingSong()).toEqual(before.nowPlaying?.song ?? null);
    expect(f.queue.snapshot().nowPlaying?.status).toBe("waiting");
  });
}

test("이전 곡 저장 중 들어온 건너뛰기는 복원된 다른 곡을 멈추지 않아요", async () => {
  await using f = await fixture();
  await seedHistory(f.queue);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const persist = f.repo.returnToPrevious.bind(f.repo);
  f.repo.returnToPrevious = async (...args) => {
    entered.resolve();
    await release.promise;
    await persist(...args);
  };
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;

  const previous = playback.previous();
  await entered.promise;
  const skipping = playback.skip();
  release.resolve();
  await Promise.all([previous, skipping]);

  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop", "play"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadQueue()).toEqual([song("b"), song("c")]);
});
