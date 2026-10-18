import { expect, test } from "bun:test";
import { onChange } from "../shared/bus";
import { connection, FakePlayer, fixture, song, state } from "./test-support";

const browser = { ...connection, location: "browser" as const };
const browserMode = browser.target;

function clock() {
  let now = 100;
  const callbacks: Array<() => void> = [];
  const pending = new Set<() => void>();
  return {
    now: () => now,
    callbacks,
    pending,
    scheduleLease(callback: () => void) {
      callbacks.push(callback);
      pending.add(callback);
      return () => {
        pending.delete(callback);
      };
    },
    advance(milliseconds: number) {
      now += milliseconds;
      for (const callback of [...pending]) callback();
    },
  };
}

test("브라우저 lease 만료는 신청을 보존하며 새 claim 전에는 다음 곡을 예약하지 않아요", async () => {
  await using f = await fixture();
  const time = clock();
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    ...time,
    browserMode,
    heartbeatTimeoutMs: 20,
  });
  const owner = await playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  await playing;
  const attempt = (await playback.snapshot()).attempt!;
  const observation = player.current;
  const expired = state(
    f.queue,
    (s) => s.nowPlaying?.status === "reconciliation-required",
  );

  time.advance(20);
  await expired;

  expect((await playback.snapshot()).ownerConnected).toBe(false);
  expect((await playback.snapshot()).owner?.stopConfirmed).toBe(false);
  expect(await playback.observation(owner, observation)).toBe(false);
  expect(
    await playback.confirmStopped("a", {
      ownerEpoch: owner.ownerEpoch,
      attemptId: attempt.attemptId,
    }),
  ).toBe(false);
  await expect(
    playback.claimOwner({
      executorSessionId: "browser-b",
      connection: browser,
    }),
  ).rejects.toThrow();
  const fence = { ...owner, attemptId: attempt.attemptId, songId: "a" };
  expect(await playback.confirmBrowserStopped(fence)).toBe(true);
  expect(await playback.confirmBrowserStopped(fence)).toBe(false);
  expect((await playback.snapshot()).owner?.released).toBe(true);
  expect(await f.playbackRepo.loadAttempt()).toBeNull();
  expect(await f.repo.loadHistory()).toEqual([song("a")]);
  expect(await f.repo.loadQueue()).toEqual([song("b")]);
  expect(player.calls).toHaveLength(1);

  const next = state(f.queue, (s) => s.nowPlaying?.song.id === "b");
  await playback.claimOwner({
    executorSessionId: "browser-b",
    connection: browser,
  });
  await next;
  expect((await playback.snapshot()).owner?.ownerEpoch).toBe(
    owner.ownerEpoch + 1,
  );
  expect(await playback.observation(owner, observation)).toBe(false);
});

test("소유권 해제 직전 SQL 실패는 완료와 history 및 모든 메모리·이벤트를 롤백해요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  player.outcome = "unknown";
  const { playback } = f.start(player, null, undefined, undefined, {
    browserMode,
  });
  const owner = await playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  const unknown = state(
    f.queue,
    (s) => s.nowPlaying?.status === "reconciliation-required",
  );
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  await unknown;
  await playback.reconcile({ ownerEpoch: -1, executorSessionId: "barrier" });
  const snapshot = await playback.snapshot();
  const fence = {
    ...owner,
    attemptId: snapshot.attempt!.attemptId,
    songId: "a",
  };
  const before = f.queue.snapshot();
  const commands = await f.playbackRepo.loadCommands();
  await f.client.execute(
    "CREATE TRIGGER fail_release BEFORE UPDATE ON playback_owner WHEN json_extract(NEW.data, '$.released') = 1 BEGIN SELECT RAISE(ABORT, '해제 저장 실패'); END",
  );
  const events: string[] = [];
  const off = onChange((event) => events.push(event));
  try {
    await expect(playback.confirmBrowserStopped(fence)).rejects.toThrow();

    expect(f.queue.snapshot()).toEqual(before);
    expect(await playback.snapshot()).toEqual(snapshot);
    expect(await f.playbackRepo.loadCommands()).toEqual(commands);
    expect(await f.repo.loadQueue()).toEqual(before.queue);
    expect(await f.repo.loadHistory()).toEqual(before.history);
    expect((await f.repo.loadNowPlaying())?.song).toEqual(
      before.nowPlaying?.song,
    );
    expect(events).toEqual([]);
  } finally {
    off();
  }
  await f.client.execute("DROP TRIGGER fail_release");
  expect(await playback.confirmBrowserStopped(fence)).toBe(true);
  expect(await f.repo.loadHistory()).toEqual([song("a")]);
  expect(await f.repo.loadQueue()).toEqual([song("b")]);
  expect(player.calls).toHaveLength(1);
});

test("idle null 확인은 현재 browser fence만 해제하고 stale·active·server를 거절해요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    browserMode,
  });
  const owner = await playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  const idle = { ...owner, attemptId: null, songId: null };
  const before = await playback.snapshot();
  for (const override of [
    { ownerEpoch: owner.ownerEpoch - 1 },
    { executorSessionId: "old" },
    { attemptId: "old", songId: "old" },
  ]) {
    expect(await playback.confirmBrowserStopped({ ...idle, ...override })).toBe(
      false,
    );
    expect(await playback.snapshot()).toEqual(before);
  }
  expect(await playback.confirmBrowserStopped(idle)).toBe(true);
  const next = await playback.claimOwner({
    executorSessionId: "browser-b",
    connection: browser,
  });
  expect(await playback.confirmBrowserStopped(idle)).toBe(false);
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  await f.queue.enqueue(song("a"));
  await playing;
  expect(
    await playback.confirmBrowserStopped({
      ...next,
      attemptId: null,
      songId: null,
    }),
  ).toBe(false);

  await using server = await fixture();
  const started = server.start(new FakePlayer());
  await started.playback.reconcile({
    ownerEpoch: -1,
    executorSessionId: "barrier",
  });
  const serverOwner = (await started.playback.snapshot()).owner!;
  expect(
    await started.playback.confirmBrowserStopped({
      ...serverOwner,
      attemptId: null,
      songId: null,
    }),
  ).toBe(false);
});

test("heartbeat 재설정은 취소된 timer를 무효화하고 dispose 뒤 callback도 변경하지 않아요", async () => {
  await using f = await fixture();
  const time = clock();
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    ...time,
    browserMode,
    heartbeatTimeoutMs: 20,
  });
  const owner = await playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  const stale = time.callbacks[0]!;
  time.advance(10);
  await playback.heartbeat(owner);
  time.advance(10);
  stale();
  await playback.reconcile({ ownerEpoch: -1, executorSessionId: "barrier" });
  expect((await playback.snapshot()).ownerConnected).toBe(true);
  expect(time.pending.size).toBe(1);
  const oldCallbacks = [...time.callbacks];
  expect(
    await playback.confirmBrowserStopped({
      ...owner,
      attemptId: null,
      songId: null,
    }),
  ).toBe(true);
  const next = await playback.claimOwner({
    executorSessionId: "browser-b",
    connection: browser,
  });
  for (const callback of oldCallbacks) callback();
  await playback.reconcile({ ownerEpoch: -1, executorSessionId: "barrier" });
  expect((await playback.snapshot()).owner?.ownerEpoch).toBe(next.ownerEpoch);
  expect((await playback.snapshot()).ownerConnected).toBe(true);
  await playback.dispose();
  await expect(playback.heartbeat(next)).rejects.toThrow();
  const before = await playback.snapshot();
  for (const callback of time.callbacks) callback();
  await playback.reconcile({ ownerEpoch: -1, executorSessionId: "barrier" });
  expect(await playback.snapshot()).toEqual(before);
  expect(time.pending.size).toBe(0);
});

test("서버 재시작은 저장 browser owner만으로 ready나 새 예약을 만들지 않아요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const first = f.start(player, null, undefined, undefined, { browserMode });
  const owner = await first.playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  await first.playback.dispose();
  await f.queue.enqueue(song("a"));
  const second = f.start(new FakePlayer(), null, undefined, undefined, {
    browserMode,
  });
  await second.playback.reconcile({
    ownerEpoch: -1,
    executorSessionId: "barrier",
  });

  expect((await second.playback.snapshot()).ownerConnected).toBe(false);
  expect(await f.playbackRepo.loadAttempt()).toBeNull();
  expect(await f.repo.loadQueue()).toEqual([song("a")]);
  expect(
    await second.playback.confirmBrowserStopped({
      ...owner,
      attemptId: null,
      songId: null,
    }),
  ).toBe(true);
  expect(await f.playbackRepo.loadAttempt()).toBeNull();
});
