import { expect, test } from "bun:test";
import { PlaybackService } from "./playback.service";
import { FakePlayer, fixture, seedHistory, song } from "./test-support";

for (const position of [3, 100]) {
  test(`${position}초에서 이전은 현재 신청곡을 처음부터 재생해요`, async () => {
    using f = await fixture();
    await seedHistory(f.queue);
    const player = new FakePlayer();
    player.positionSec = position;
    f.queue.updateProgress(position, 200);
    const before = f.queue.snapshot();

    await new PlaybackService(f.queue, player).previous();

    expect(player.calls).toEqual(["restart"]);
    expect(player.positionSec).toBe(0);
    expect(f.queue.snapshot().nowPlaying?.positionSec).toBe(0);
    expect(f.queue.nowPlayingSong()?.id).toBe("b");
    expect(f.queue.snapshot().queue).toEqual(before.queue);
    expect(await f.repo.loadHistory()).toEqual(before.history);
    expect((await f.repo.loadNowPlaying())?.startedAt).toBe(
      f.queue.snapshot().nowPlaying?.startedAt,
    );
  });
}

test("3초 미만이면 앨범이 아니라 최근 신청곡을 복원하고 밀린 곡을 큐 맨 앞에 저장해요", async () => {
  using f = await fixture();
  await seedHistory(f.queue);
  const player = new FakePlayer();
  player.positionSec = 2.99;
  f.queue.updateProgress(2.99, 200);

  await new PlaybackService(f.queue, player).previous();

  expect(player.calls).toEqual(["play:a"]);
  expect(f.queue.nowPlayingSong()).toEqual(song("a"));
  expect((await f.repo.loadNowPlaying())?.song).toEqual(song("a"));
  expect(f.queue.snapshot().queue).toEqual([song("b"), song("c")]);
  expect(await f.repo.loadQueue()).toEqual([song("b"), song("c")]);
  expect(f.queue.snapshot().history).toEqual([song("z")]);
  expect(await f.repo.loadHistory()).toEqual([song("z")]);
  expect(
    (
      await f.client.execute("SELECT position FROM queue ORDER BY position")
    ).rows.map((row) => row.position),
  ).toEqual([0, 1]);
});

test("히스토리가 없으면 3초 미만이어도 현재 곡을 처음으로 돌려요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  player.positionSec = 2;

  await new PlaybackService(f.queue, player).previous();

  expect(player.calls).toEqual(["restart"]);
  expect(player.positionSec).toBe(0);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadQueue()).toEqual([]);
});

test("건너뛴 직후 이전으로 돌아갔다가 완료해도 신청곡이 중복되거나 유실되지 않아요", async () => {
  using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  const playback = new PlaybackService(f.queue, player);
  await playback.skip();
  await f.queue.takeAndStart();

  await playback.previous();
  await f.queue.finishNowPlaying("done", "a");
  await f.queue.takeAndStart();

  expect((await f.repo.loadNowPlaying())?.song.id).toBe("b");
  expect(await f.repo.loadHistory()).toEqual([song("a")]);
  expect(await f.repo.loadQueue()).toEqual([]);
  expect(player.calls).toEqual(["stop", "play:a"]);
});

for (const position of [0, 20]) {
  test(`일시정지 중 ${position}초에서 이전을 눌러도 멈춤 상태를 유지해요`, async () => {
    using f = await fixture();
    await seedHistory(f.queue);
    const player = new FakePlayer();
    player.positionSec = position;
    const playback = new PlaybackService(f.queue, player);
    await playback.pause();

    await playback.previous();

    expect(player.state).toBe("paused");
    expect(player.positionSec).toBe(0);
    expect(f.queue.snapshot().nowPlaying?.status).toBe("paused");
    expect(f.queue.nowPlayingSong()?.id).toBe(position === 0 ? "a" : "b");
  });
}

for (const position of [0, 20]) {
  test(`이전 ${position}초 전환의 저장 실패는 메모리와 DB와 플레이어를 바꾸지 않아요`, async () => {
    using f = await fixture();
    await seedHistory(f.queue);
    const player = new FakePlayer();
    player.positionSec = position;
    const before = f.queue.snapshot();
    const stored = await f.repo.loadNowPlaying();
    await f.client.execute(
      "CREATE TRIGGER fail_previous BEFORE UPDATE ON now_playing BEGIN SELECT RAISE(ABORT, '실패'); END",
    );

    await expect(
      new PlaybackService(f.queue, player).previous(),
    ).rejects.toThrow();

    expect(player.calls).toEqual([]);
    expect(f.queue.snapshot()).toEqual(before);
    expect(await f.repo.loadNowPlaying()).toEqual(stored);
    expect(await f.repo.loadHistory()).toEqual(before.history);
    expect(await f.repo.loadQueue()).toEqual(before.queue);
  });
}

test("이전 곡 저장 중 들어온 건너뛰기는 복원된 다른 곡을 멈추지 않아요", async () => {
  using f = await fixture();
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
  const playback = new PlaybackService(f.queue, player);

  const previous = playback.previous();
  await entered.promise;
  const skipping = playback.skip();
  release.resolve();
  await Promise.all([previous, skipping]);

  expect(player.calls).toEqual(["play:a"]);
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  expect(await f.repo.loadQueue()).toEqual([song("b"), song("c")]);
});
