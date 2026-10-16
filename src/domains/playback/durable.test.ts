import { expect, test } from "bun:test";
import type {
  ConnectedTarget,
  PlaybackObservation,
} from "../../music/contracts";
import { composeState } from "../shared/state-view";
import type { OwnerIdentity } from "./protocol";
import { connection, FakePlayer, fixture, song, state } from "./test-support";

const browser: ConnectedTarget = { ...connection, location: "browser" };
const browserMode = {
  providerId: browser.target.providerId,
  modeId: browser.target.modeId,
};

test("예약은 큐와 시도와 prepared 명령을 함께 저장하며 실제 시작 시각을 분리해요", async () => {
  await using f = await fixture();
  let now = 100;
  const player = new FakePlayer();
  player.autoObserve = false;
  const dispatched = Promise.withResolvers<void>();
  player.beforeExecute = async () => {
    const attempt = await f.playbackRepo.loadAttempt();
    const commands = await f.playbackRepo.loadCommands();
    expect(attempt).toMatchObject({
      songId: "a",
      reservedAt: 100,
      startedAt: null,
      state: "starting",
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.state).toBe("sent");
    expect(await f.repo.loadQueue()).toEqual([]);
    dispatched.resolve();
  };
  await f.queue.enqueue(song("a"));
  const { playback } = f.start(player, connection, undefined, undefined, {
    now: () => now,
  });
  await dispatched.promise;
  await playback.heartbeat((await playback.snapshot()).owner!);
  expect(f.queue.snapshot().nowPlaying?.startedAt).toBeNull();
  now = 250;
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );

  player.report({}, "playing");
  await playing;

  expect(await f.playbackRepo.loadAttempt()).toMatchObject({
    reservedAt: 100,
    startedAt: 250,
    binding: player.current.binding,
    sequence: player.current.sequence,
  });
  expect((await f.repo.loadNowPlaying())?.startedAt).toBe(250);
});

test("초기 명령 삽입 실패는 예약 전체를 롤백하며 외부 호출이 없어요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.client.execute(
    "CREATE TRIGGER fail_command BEFORE INSERT ON playback_commands BEGIN SELECT RAISE(ABORT, '명령 저장 실패'); END",
  );
  const player = new FakePlayer();

  const { running } = f.start(player);
  await expect(running).rejects.toThrow();

  expect(player.calls).toEqual([]);
  expect(await f.repo.loadQueue()).toEqual([song("a")]);
  expect(await f.repo.loadNowPlaying()).toBeNull();
  expect(await f.playbackRepo.loadAttempt()).toBeNull();
  expect(await f.playbackRepo.loadCommands()).toEqual([]);
});

test("sent 저장 실패는 prepared 명령과 신청을 보존하고 외부 호출을 막아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.client.execute(
    "CREATE TRIGGER fail_sent BEFORE UPDATE ON playback_commands WHEN json_extract(NEW.data, '$.state') = 'sent' BEGIN SELECT RAISE(ABORT, '전송 전 실패'); END",
  );
  const player = new FakePlayer();
  const waiting = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "waiting",
  );

  f.start(player);
  await waiting;

  expect(player.calls).toEqual([]);
  expect((await f.playbackRepo.loadCommands())[0]?.state).toBe("prepared");
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
});

test("전송 뒤 receipt 저장 실패는 결과 불명으로 남고 다음 신청에도 재전송하지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.client.execute(
    "CREATE TRIGGER fail_receipt BEFORE UPDATE ON playback_commands WHEN json_extract(NEW.data, '$.state') = 'received' BEGIN SELECT RAISE(ABORT, '전송 후 실패'); END",
  );
  const player = new FakePlayer();
  player.autoObserve = false;
  const unknown = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "reconciliation-required",
  );
  const { playback } = f.start(player);
  await unknown;

  await f.queue.enqueue(song("b"));
  await playback.dispose();

  expect(player.calls.map((command) => command.type)).toEqual(["play"]);
  expect((await f.playbackRepo.loadCommands())[0]?.state).toBe("unknown");
  expect(await f.repo.loadQueue()).toEqual([song("b")]);
});

test("최초 playing 저장 실패는 binding과 시작 시각과 command 확정을 함께 롤백해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.client.execute(
    "CREATE TRIGGER fail_observation BEFORE UPDATE ON now_playing BEGIN SELECT RAISE(ABORT, '관측 저장 실패'); END",
  );
  const player = new FakePlayer();

  const { running } = f.start(player);
  await expect(running).rejects.toThrow();

  expect(await f.playbackRepo.loadAttempt()).toMatchObject({
    startedAt: null,
    binding: null,
    sequence: -1,
  });
  expect((await f.playbackRepo.loadCommands())[0]?.state).toBe("received");
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
});

test("완료 저장 실패는 종료 시도와 명령과 history까지 원자적으로 보존해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const { playback } = f.start(player);
  await playing;
  await f.client.execute(
    "CREATE TRIGGER fail_finish BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '완료 실패'); END",
  );

  await expect(playback.skip()).rejects.toThrow();

  expect(await f.playbackRepo.loadAttempt()).toMatchObject({
    songId: "a",
    state: "waiting",
  });
  expect((await f.playbackRepo.loadCommands()).at(-1)?.state).toBe("confirmed");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect(await f.repo.loadQueue()).toEqual([song("b")]);
  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
});

test("중복과 역순 관측은 저장된 sequence와 최초 시작 시간을 되돌리지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  let now = 100;
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const { playback } = f.start(player, connection, undefined, undefined, {
    now: () => now,
  });
  await playing;
  const owner = (await playback.snapshot()).owner!;
  const first = player.current;
  now = 500;
  const newer: PlaybackObservation = {
    ...first,
    sequence: first.sequence + 2,
    positionSec: 7,
  };

  expect(await playback.observation(owner, newer)).toBe(true);
  expect(await playback.observation(owner, first)).toBe(false);
  expect(await playback.observation(owner, newer)).toBe(false);

  expect(await f.playbackRepo.loadAttempt()).toMatchObject({
    sequence: newer.sequence,
    positionSec: 7,
    startedAt: 100,
  });
});

test("서버 재시작은 저장 binding을 대조하고 같은 곡의 play를 다시 보내지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const first = f.start(player);
  await playing;
  const original = await f.playbackRepo.loadAttempt();
  await first.playback.dispose();
  const bindings: unknown[] = [];
  const reconcile = player.reconcile.bind(player);
  player.reconcile = async (binding) => {
    bindings.push(binding);
    return reconcile();
  };

  const second = f.start(player);
  await state(f.queue, (snapshot) => snapshot.nowPlaying?.status === "playing");

  expect(bindings).toEqual([original?.binding]);
  expect(player.calls.map((command) => command.type)).toEqual(["play"]);
  expect((await second.playback.snapshot()).attempt?.attemptId).toBe(
    original?.attemptId,
  );
});

test("unknown 재시작은 자동 reconciliation이나 play 재전송 없이 관리자 확인을 기다려요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  player.outcome = "unknown";
  const unknown = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "reconciliation-required",
  );
  const first = f.start(player);
  await unknown;
  await first.playback.dispose();
  let reconciliations = 0;
  const reconcile = player.reconcile.bind(player);
  player.reconcile = async () => {
    reconciliations += 1;
    return reconcile();
  };

  const second = f.start(player);
  await second.playback.heartbeat((await f.playbackRepo.loadOwner())!);

  expect(reconciliations).toBe(0);
  expect(player.calls.map((command) => command.type)).toEqual(["play"]);
  expect((await second.playback.snapshot()).commands[0]?.state).toBe("unknown");
  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");
});

test("서버 연결 세대 변경은 물리 정지 확인 뒤에만 새 epoch와 다음 신청을 시작해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const first = f.start(player);
  await playing;
  const previous = await first.playback.snapshot();
  await first.playback.dispose();
  const reconnected = { ...connection, connectionGeneration: "connection:2" };
  player.reconcile = async () => ({
    ok: true,
    value: {
      status: "match",
      observation: {
        ...player.current,
        connectionGeneration: reconnected.connectionGeneration,
      },
    },
  });
  const second = f.start(player, reconnected);
  await second.playback.heartbeat(previous.owner!);
  expect(f.queue.snapshot().nowPlaying?.status).toBe("reconciliation-required");
  expect(player.calls).toHaveLength(1);
  const next = state(
    f.queue,
    (snapshot) =>
      snapshot.nowPlaying?.song.id === "b" &&
      snapshot.nowPlaying.status === "playing",
  );

  expect(
    await second.playback.confirmStopped("a", {
      attemptId: previous.attempt!.attemptId,
      ownerEpoch: previous.owner!.ownerEpoch,
    }),
  ).toBe(true);
  await next;

  expect((await second.playback.snapshot()).owner?.ownerEpoch).toBe(
    previous.owner!.ownerEpoch + 1,
  );
  expect(player.calls.map((command) => command.type)).toEqual(["play", "play"]);
  expect(player.calls[1]?.context.connectionGeneration).toBe("connection:2");
  expect(await f.repo.loadHistory()).toEqual([song("a")]);
});

test("브라우저는 명시적 선택 전 재생하지 않고 heartbeat 만료에도 다른 기기를 허가하지 않아요", async () => {
  await using f = await fixture();
  let now = 10;
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    browserMode,
    now: () => now,
    heartbeatTimeoutMs: 20,
  });
  await f.queue.enqueue(song("a"));
  expect((await playback.snapshot()).owner).toBeNull();
  expect(player.calls).toEqual([]);
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const owner = await playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  await playing;
  now = 100;

  await expect(
    playback.claimOwner({
      executorSessionId: "browser-b",
      connection: browser,
    }),
  ).rejects.toThrow();

  expect((await playback.snapshot()).ownerConnected).toBe(false);
  expect((await playback.snapshot()).owner?.ownerEpoch).toBe(owner.ownerEpoch);
  expect(player.calls.map((command) => command.type)).toEqual(["play"]);
});

test("정지 관측과 해제 후 새 owner는 epoch를 올리고 이전 실행기의 모든 메시지를 거절해요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    browserMode,
  });
  const owner = await playback.claimOwner({
    executorSessionId: "browser-a",
    connection: browser,
  });
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  await f.queue.enqueue(song("a"));
  await playing;
  const oldObservation = player.current;
  const oldCommand = player.calls[0]!;
  expect(await playback.releaseOwner(owner)).toBe(true);

  const next = await playback.claimOwner({
    executorSessionId: "browser-b",
    connection: browser,
  });

  expect(next.ownerEpoch).toBe(owner.ownerEpoch + 1);
  expect(
    await playback.receipt(owner, {
      status: "accepted",
      context: oldCommand.context,
    }),
  ).toBe(false);
  expect(await playback.observation(owner, oldObservation)).toBe(false);
  expect(await playback.reconcile(owner)).toBe(false);
  expect(await playback.releaseOwner(owner)).toBe(false);
  await expect(playback.heartbeat(owner)).rejects.toThrow();
  expect(player.calls.map((command) => command.type)).toEqual(["play", "stop"]);
  expect(await f.repo.loadHistory()).toEqual([song("a")]);
});

test("물리 정지 확인은 지정 attempt와 epoch가 맞을 때만 완료해요", async () => {
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
    (snapshot) => snapshot.nowPlaying?.status === "reconciliation-required",
  );
  await f.queue.enqueue(song("a"));
  await unknown;
  const attempt = (await playback.snapshot()).attempt!;
  expect(await playback.confirmStopped("a")).toBe(false);
  expect(
    await playback.confirmStopped("a", {
      attemptId: "stale",
      ownerEpoch: owner.ownerEpoch,
    }),
  ).toBe(false);
  expect(
    await playback.confirmStopped("a", {
      attemptId: attempt.attemptId,
      ownerEpoch: owner.ownerEpoch - 1,
    }),
  ).toBe(false);

  expect(
    await playback.confirmStopped("a", {
      attemptId: attempt.attemptId,
      ownerEpoch: owner.ownerEpoch,
    }),
  ).toBe(true);

  expect((await playback.snapshot()).owner?.stopConfirmed).toBe(true);
  expect(await playback.releaseOwner(owner)).toBe(true);
  const next = await playback.claimOwner({
    executorSessionId: "browser-b",
    connection: browser,
  });
  expect(next.ownerEpoch).toBe(owner.ownerEpoch + 1);
  expect(player.calls).toHaveLength(1);
});

test("저장소는 stale owner의 예약과 완료를 SQL 전환 전에 거절해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const { playback } = f.start(player);
  await playing;
  const attempt = (await playback.snapshot()).attempt!;
  const stale: OwnerIdentity = {
    ownerEpoch: attempt.ownerEpoch - 1,
    executorSessionId: attempt.context.executorSessionId,
  };

  await expect(
    f.repo.finishNowPlaying(song("a"), "done", 50, {
      ...stale,
      attemptId: attempt.attemptId,
    }),
  ).rejects.toThrow();

  expect((await f.repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await f.repo.loadHistory()).toEqual([]);
  expect((await f.playbackRepo.loadAttempt())?.attemptId).toBe(
    attempt.attemptId,
  );
});

test("ended POST는 정지 관측을 기다리기 전에 응답해 직렬 관측 전송을 막지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const { playback } = f.start(player);
  await playing;
  player.autoObserve = false;
  const owner = (await playback.snapshot()).owner!;
  const ended: PlaybackObservation = {
    ...player.current,
    state: "ended",
    endReason: "natural-end",
    sequence: player.current.sequence + 1,
  };
  const stopped = player.called("stop");

  expect(await playback.observation(owner, ended)).toBe(true);
  await stopped;
  const context = player.calls.at(-1)!.context;
  expect(
    await playback.observation(owner, {
      ...ended,
      correlation: context,
      target: context.target,
      connectionGeneration: context.connectionGeneration,
      state: "stopped",
      endReason: undefined,
      trackRef: null,
      binding: null,
      sequence: ended.sequence + 1,
    }),
  ).toBe(true);
  await state(f.queue, (snapshot) => snapshot.nowPlaying === null);

  expect(await f.repo.loadHistory()).toEqual([song("a")]);
});

test("관리자 snapshot의 binding과 owner와 명령은 공개 상태로 새지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  const player = new FakePlayer();
  const playing = state(
    f.queue,
    (snapshot) => snapshot.nowPlaying?.status === "playing",
  );
  const { playback } = f.start(player);
  await playing;
  const admin = await playback.snapshot();

  const publicState = composeState(
    f.queue,
    {
      read: () => ({
        requestsPaused: false,
        notice: "",
        maxPerDevice: 1,
        maxPerTable: 5,
      }),
    },
    "",
  );

  expect(admin.attempt?.binding).not.toBeNull();
  const serialized = JSON.stringify(publicState);
  for (const secret of [
    "binding",
    "executorSessionId",
    "ownerEpoch",
    "commandId",
    "targetId",
    "native:",
  ]) {
    expect(serialized).not.toContain(secret);
  }
});
