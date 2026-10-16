import { expect, test } from "bun:test";
import { connection, FakePlayer, fixture, song, state } from "./test-support";

test("재생은 예약 저장 뒤 실행하고 접수만으로 playing을 만들지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  player.autoObserve = false;
  const accepted = Promise.withResolvers<void>();
  player.beforeExecute = async () => {
    expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
    expect(await f.repo.loadQueue()).toEqual([]);
  };
  const execute = player.execute.bind(player);
  player.execute = async (...args) => {
    const result = await execute(...args);
    accepted.resolve();
    return result;
  };
  f.start(player);
  await accepted.promise;
  expect(f.queue.snapshot().nowPlaying?.status).toBe("starting");

  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  player.deliver(player.current);
  await playing;

  expect(await f.repo.loadHistory()).toEqual([]);
});

test("빈 큐는 버스 알림으로 깨어나며 관측한 종료와 정지 뒤 다음 곡을 시작해요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  f.start(player);
  const first = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  await f.queue.enqueue(song("a"));
  await first;
  await f.queue.enqueue(song("b"));
  const next = state(
    f.queue,
    (s) => s.nowPlaying?.song.id === "b" && s.nowPlaying.status === "playing",
  );

  player.end();
  await next;

  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop", "play"]);
  expect((await f.repo.loadHistory()).map((s) => s.id)).toEqual(["a"]);
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("b");
});

test("복원된 현재 곡은 재생하거나 무관한 관측으로 완료하지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  const { playback } = f.start(player);

  await expect(playback.skip()).rejects.toThrow("현재 재생을 확인");

  expect(player.calls).toEqual([]);
  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
});

test("복원된 다른 공급자 곡은 보존하고 외부 명령을 보내지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue({
    ...song("a"),
    ref: { providerId: "another-provider", trackId: "opaque:A" },
  });
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  const { playback } = f.start(player);

  await expect(playback.resume()).rejects.toThrow();

  expect(player.calls).toEqual([]);
  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");
});

test("복원 후 명시적 제어는 binding의 일치를 확인한 실행만 이어 받아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  await player.execute(
    {
      type: "play",
      trackRef: song("a").ref,
      initialState: "playing",
      context: {
        target: connection.target,
        connectionGeneration: connection.connectionGeneration,
        commandId: "existing-command",
        attemptId: "existing-attempt",
        executorSessionId: "existing-executor",
      },
    },
    new AbortController().signal,
  );
  const { playback } = f.start(player);
  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");

  const paused = state(f.queue, (s) => s.nowPlaying?.status === "paused");
  await playback.pause();
  await paused;

  expect(player.calls.map((c) => c.type)).toEqual(["play", "pause"]);
  expect(player.calls[1]!.context.attemptId).toBe("existing-attempt");
  expect(player.calls[1]!.context.executorSessionId).toBe("existing-executor");
  expect(await f.repo.loadHistory()).toEqual([]);
});

test("시작 저장 실패는 외부 재생 없이 시작 수명에 오류를 전달해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.client.execute(
    "CREATE TRIGGER fail_start BEFORE INSERT ON now_playing BEGIN SELECT RAISE(ABORT, '시작 실패'); END",
  );
  const player = new FakePlayer();

  const { running } = f.start(player);
  await expect(running).rejects.toThrow();

  expect(player.calls).toEqual([]);
  expect(f.queue.snapshot().queue.map((s) => s.id)).toEqual(["a"]);
  expect((await f.repo.loadQueue()).map((s) => s.id)).toEqual(["a"]);
});

test("완료 저장 실패는 현재 곡을 보존하고 다음 재생을 차단해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  await f.client.execute(
    "CREATE TRIGGER fail_finish BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '완료 실패'); END",
  );
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { running } = f.start(player);
  await playing;

  player.end();
  await expect(running).rejects.toThrow();

  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop"]);
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect((await f.repo.loadQueue()).map((s) => s.id)).toEqual(["b"]);
});

test("동시 건너뛰기는 한 번만 정지하고 완료해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;

  await Promise.all([playback.skip(), playback.skip()]);

  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop"]);
  expect(f.queue.nowPlayingSong()).toBeNull();
  expect((await f.repo.loadHistory()).map((s) => s.id)).toEqual(["a"]);
});

test("완료 저장 중 들어온 건너뛰기는 다음 곡을 멈추지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const finish = f.repo.finishNowPlaying.bind(f.repo);
  f.repo.finishNowPlaying = async (...args) => {
    entered.resolve();
    await release.promise;
    await finish(...args);
  };
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  player.end();
  await entered.promise;
  const next = state(f.queue, (s) => s.nowPlaying?.song.id === "b");

  const skipping = playback.skip();
  release.resolve();
  await skipping;
  await next;

  expect(player.calls.filter((c) => c.type === "stop")).toHaveLength(1);
  expect((await f.repo.loadHistory()).map((s) => s.id)).toEqual(["a"]);
});

test("재생 준비 중 건너뛰기는 재생 다음에 정지를 확인해요", async () => {
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

  const skipping = playback.skip();
  release.resolve();
  await skipping;

  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop"]);
  expect(f.queue.nowPlayingSong()).toBeNull();
});

test("정지 실패와 완료 저장 실패 뒤 명시적 재시도는 신청을 한 번만 완료해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  const { playback } = f.start(player);
  await playing;
  player.outcome = "rejected";
  await expect(playback.skip()).rejects.toThrow("disconnected");
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  player.outcome = "accepted";
  await f.client.execute(
    "CREATE TRIGGER fail_skip BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '실패'); END",
  );
  await expect(playback.skip()).rejects.toThrow();
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  await f.client.execute("DROP TRIGGER fail_skip");

  await playback.skip();

  expect(f.queue.nowPlayingSong()).toBeNull();
  expect(await f.repo.loadNowPlaying()).toBeNull();
  expect((await f.repo.loadHistory()).map((s) => s.id)).toEqual(["a"]);
});

for (const outcome of ["unknown", "rejected"] as const) {
  test(`재생 ${outcome} 결과는 현재 곡을 보존하고 자동 재전송하지 않아요`, async () => {
    await using f = await fixture();
    await f.queue.enqueue(song("a"));
    const player = new FakePlayer();
    player.outcome = outcome;
    const retained = state(
      f.queue,
      (s) =>
        s.nowPlaying?.status ===
        (outcome === "unknown" ? "reconciliation-required" : "waiting"),
    );
    const { playback } = f.start(player);
    await retained;

    await f.queue.enqueue(song("b"));
    await playback.dispose();

    expect(player.calls.map((c) => c.type)).toEqual(["play"]);
    expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
    expect((await f.repo.loadQueue()).map((s) => s.id)).toEqual(["b"]);
  });
}

test("비활성 재생은 구독이나 외부 명령 없이 관리자 제어를 받아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const { playback, running } = f.start(player, null);

  await Promise.all([
    running,
    playback.skip(),
    playback.pause(),
    playback.previous(),
  ]);

  expect(player.calls).toEqual([]);
  expect(player.subscribers).toBe(0);
  expect((await f.repo.loadQueue()).map((s) => s.id)).toEqual(["a"]);
});

test("비활성 재생의 활성 곡 제어는 성공으로 가장하지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.takeAndStart();
  const player = new FakePlayer();
  const { playback } = f.start(player, null);

  await expect(playback.skip()).rejects.toThrow("재생 기기가 연결되지");

  expect(player.calls).toEqual([]);
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
});
