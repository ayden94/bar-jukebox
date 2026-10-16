import { expect, test } from "bun:test";
import { FakePlayer, fixture, song, state } from "./test-support";

test("물리적 정지 확인은 복원된 신청만 한 번 완료하고 다음 곡을 시작해요", async () => {
  await using setup = await fixture();
  await setup.queue.enqueue(song("old"));
  await setup.queue.enqueue(song("next"));
  await setup.queue.takeAndStart();
  const player = new FakePlayer();
  const { playback } = setup.start(player);
  expect(setup.queue.snapshot().nowPlaying?.status).toBe(
    "reconciliation-required",
  );
  expect(player.calls).toEqual([]);
  const next = state(
    setup.queue,
    (snapshot) =>
      snapshot.nowPlaying?.song.id === "next" &&
      snapshot.nowPlaying.status === "playing",
  );
  const results = await Promise.all([
    playback.confirmStopped("old"),
    playback.confirmStopped("old"),
  ]);
  expect(results).toEqual([true, false]);
  await next;
  expect(setup.queue.snapshot().history.map((entry) => entry.id)).toEqual([
    "old",
  ]);
  expect(player.calls.map((command) => command.type)).toEqual(["play"]);
});

test("정지 확인은 다른 신청이나 정상 재생 상태를 완료하지 않아요", async () => {
  await using setup = await fixture();
  await setup.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(
    setup.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const { playback } = setup.start(player);
  await playing;
  expect(await playback.confirmStopped("other")).toBe(false);
  expect(await playback.confirmStopped("a")).toBe(false);
  expect(setup.queue.nowPlayingSong()?.id).toBe("a");
});

test("정지 확인 저장 실패는 신청을 남기고 외부 재생을 시작하지 않아요", async () => {
  await using setup = await fixture();
  await setup.queue.enqueue(song("a"));
  await setup.queue.takeAndStart();
  const player = new FakePlayer();
  const { playback } = setup.start(player);
  setup.repo.finishNowPlaying = async () => {
    throw new Error("저장 실패");
  };
  await expect(playback.confirmStopped("a")).rejects.toThrow("저장 실패");
  expect(setup.queue.nowPlayingSong()?.id).toBe("a");
  expect(player.calls).toEqual([]);
});
