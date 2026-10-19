import { expect, test } from "bun:test";
import type { BackgroundHandoff } from "./playback.service";
import { FakePlayer, fixture, song, state } from "./test-support";

function handoff(options: { holdFirst?: boolean } = {}) {
  const calls: string[] = [];
  const waiters: Array<{ name: string; resolve: () => void }> = [];
  const record = (name: string) => {
    calls.push(name);
    for (const waiter of waiters.splice(0)) {
      if (waiter.name === name) waiter.resolve();
      else waiters.push(waiter);
    }
  };
  let ready: (() => void) | null = null;
  let hold = options.holdFirst ?? false;
  const fake: BackgroundHandoff = {
    bind(callback) {
      ready = callback;
    },
    async idle() {
      record("idle");
    },
    async beforeRequest() {
      record("before");
      return !hold;
    },
    async startNow() {
      calls.push("start");
    },
    async stopNow() {
      calls.push("stop");
    },
    dispose() {
      calls.push("dispose");
    },
  };
  return {
    fake,
    calls,
    // 호출을 먼저 구독하고 기다려요. 시간 경과를 성공 조건으로 쓰지 않아요.
    called(name: string): Promise<void> {
      if (calls.includes(name)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`배경 호출을 받지 못했어요: ${name}`)),
          2000,
        );
        waiters.push({
          name,
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
        });
      });
    },
    release() {
      hold = false;
      ready?.();
    },
  };
}

test("배경: 대기열이 비면 배경 음악을 맡기고 신청이 오면 넘겨받아요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const background = handoff();
  const { playback } = f.start(player, undefined, undefined, undefined, {
    background: background.fake,
  });
  await background.called("idle");

  await f.queue.enqueue(song("a"));
  await player.called("play");

  expect(background.calls).toContain("before");
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
  await playback.dispose();
  expect(background.calls).toContain("dispose");
});

test("배경: 배경곡이 끝날 때까지 기다린 뒤 신청곡을 시작해요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const background = handoff({ holdFirst: true });
  f.start(player, undefined, undefined, undefined, {
    background: background.fake,
  });

  await f.queue.enqueue(song("a"));
  await background.called("before");
  expect(player.calls).toEqual([]);
  expect(f.queue.snapshot().queue.map((item) => item.id)).toEqual(["a"]);

  background.release();
  await player.called("play");
  expect(f.queue.nowPlayingSong()?.id).toBe("a");
});

test("배경: 다른 곡으로 바뀐 신청곡은 확인 없이 끝내고 다음 곡으로 넘어가요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  f.start(player);
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  await f.queue.enqueue(song("a"));
  await playing;
  await f.queue.enqueue(song("b"));
  const next = state(
    f.queue,
    (s) => s.nowPlaying?.song.id === "b" && s.nowPlaying.status === "playing",
  );

  player.end("replaced");

  await next;
  expect(player.calls.map((c) => c.type)).toEqual(["play", "stop", "play"]);
  expect(f.queue.snapshot().history[0]?.id).toBe("a");
});

test("배경: 신청곡이 남아 있으면 직원이 배경을 바꿀 수 없어요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const background = handoff({ holdFirst: true });
  const { playback } = f.start(player, undefined, undefined, undefined, {
    background: background.fake,
  });
  await f.queue.enqueue(song("a"));

  await expect(playback.startBackground()).rejects.toThrow(
    "신청곡이 있을 때는",
  );
  await expect(playback.stopBackground()).rejects.toThrow("신청곡이 있을 때는");
  expect(background.calls).not.toContain("start");
});

test("배경: 신청곡이 없으면 직원이 배경을 켜고 끌 수 있어요", async () => {
  await using f = await fixture();
  const player = new FakePlayer();
  const background = handoff();
  const { playback } = f.start(player, undefined, undefined, undefined, {
    background: background.fake,
  });

  await playback.startBackground();
  await playback.stopBackground();

  expect(background.calls).toContain("start");
  expect(background.calls).toContain("stop");
});
