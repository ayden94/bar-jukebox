import { expect, test } from "bun:test";
import type {
  BackgroundObservation,
  BackgroundPort,
} from "../../music/contracts";
import {
  type BackgroundSettings,
  DEFAULT_BACKGROUND,
} from "./background.repository";
import { BackgroundPlayer } from "./background-player";

function harness(initial: Partial<BackgroundSettings> = {}) {
  let settings: BackgroundSettings = {
    ...DEFAULT_BACKGROUND,
    enabled: true,
    playlist: "재즈",
    ...initial,
  };
  let native: BackgroundObservation = {
    state: "stopped",
    trackKey: null,
    title: null,
    artist: null,
    playlist: null,
    positionSec: null,
    durationSec: null,
  };
  const calls: string[] = [];
  let startResult: "ok" | "fail" = "ok";
  const port: BackgroundPort = {
    async listPlaylists() {
      return { ok: true, value: ["재즈"] };
    },
    async start(playlist) {
      calls.push(`start:${playlist}`);
      if (startResult === "fail")
        return { ok: false, error: { code: "unknown-outcome" } };
      native = {
        state: "playing",
        trackKey: "bg-1",
        title: "Blue",
        artist: "Miles",
        playlist,
        positionSec: 0,
        durationSec: 300,
      };
      return { ok: true, value: undefined };
    },
    async fadeOut() {
      calls.push("fade");
      native = { ...native, state: "stopped" };
      return { ok: true, value: undefined };
    },
    async observe() {
      return { ok: true, value: native };
    },
  };
  let scheduled: (() => Promise<void>) | null = null;
  const player = new BackgroundPlayer(
    port,
    { read: () => settings },
    (callback) => {
      scheduled = callback;
      return () => {
        if (scheduled === callback) scheduled = null;
      };
    },
  );
  let readyCount = 0;
  player.bind(() => {
    readyCount += 1;
  });
  return {
    player,
    calls,
    get readyCount() {
      return readyCount;
    },
    setNative(update: Partial<BackgroundObservation>) {
      native = { ...native, ...update };
    },
    setSettings(update: Partial<BackgroundSettings>) {
      settings = { ...settings, ...update };
    },
    failStart() {
      startResult = "fail";
    },
    async tick() {
      const callback = scheduled;
      if (!callback) throw new Error("예약된 관측이 없어요");
      scheduled = null;
      await callback();
    },
    get scheduled() {
      return scheduled !== null;
    },
  };
}

test("대기열이 비면 지정한 재생 목록을 틀고 공개 상태에 곡만 보여줘요", async () => {
  const h = harness();
  await h.player.idle();

  expect(h.calls).toEqual(["start:재즈"]);
  expect(h.player.now()).toEqual({ title: "Blue", artist: "Miles" });
  expect(h.player.status()).toMatchObject({ active: true, playlist: "재즈" });
});

test("이미 음악이 흐르면 다시 시작하지 않고 그 음악을 배경으로 인정해요", async () => {
  const h = harness();
  h.setNative({
    state: "playing",
    trackKey: "staff",
    title: "직원 선곡",
    artist: "누군가",
  });
  await h.player.idle();

  expect(h.calls).toEqual([]);
  expect(h.player.now()).toEqual({ title: "직원 선곡", artist: "누군가" });
});

test("배경이 꺼져 있으면 아무것도 틀지 않고 신청곡을 바로 시작해요", async () => {
  const h = harness({ enabled: false });
  h.setNative({ state: "playing", trackKey: "x", title: "추천곡" });
  await h.player.idle();

  expect(h.calls).toEqual([]);
  expect(h.player.now()).toBeNull();
  expect(await h.player.beforeRequest()).toBe(true);
  expect(h.calls).toEqual([]);
});

test("기본 인계는 지금 배경곡이 끝날 때까지 기다린 뒤 신청곡에 자리를 내줘요", async () => {
  const h = harness();
  await h.player.idle();

  expect(await h.player.beforeRequest()).toBe(false);
  expect(h.player.status().waitingForTrackEnd).toBe(true);
  expect(h.calls).toEqual(["start:재즈"]);

  h.setNative({ positionSec: 120 });
  await h.tick();
  expect(h.readyCount).toBe(0);

  h.setNative({ trackKey: "bg-2", title: "Next", positionSec: 0 });
  await h.tick();
  expect(h.readyCount).toBe(1);
  expect(await h.player.beforeRequest()).toBe(true);
  expect(h.calls).toEqual(["start:재즈", "fade"]);
});

test("배경곡이 끝나기 직전이어도 신청곡 차례로 봐요", async () => {
  const h = harness();
  await h.player.idle();
  expect(await h.player.beforeRequest()).toBe(false);

  h.setNative({ positionSec: 299 });
  await h.tick();

  expect(h.readyCount).toBe(1);
});

test("즉시 인계는 배경 음악을 줄이며 멈추고 바로 신청곡을 시작해요", async () => {
  const h = harness({ handoff: "immediate" });
  await h.player.idle();

  expect(await h.player.beforeRequest()).toBe(true);
  expect(h.calls).toEqual(["start:재즈", "fade"]);
  expect(h.player.now()).toBeNull();
});

test("신청곡 사이에 흐른 자동 추천곡은 기다리지 않아요", async () => {
  const h = harness();
  h.setNative({ state: "playing", trackKey: "auto", title: "추천" });

  expect(await h.player.beforeRequest()).toBe(true);
  expect(h.calls).toEqual([]);
});

test("직원이 배경을 멈추면 다음 변경 알림에 다시 틀지 않아요", async () => {
  const h = harness();
  await h.player.idle();
  await h.player.stopNow();
  await h.player.idle();

  expect(h.calls).toEqual(["start:재즈", "fade"]);
  expect(h.player.now()).toBeNull();

  await h.player.startNow();
  expect(h.calls).toEqual(["start:재즈", "fade", "start:재즈"]);
});

test("재생 목록 시작에 실패하면 오류를 보여주고 반복해서 시도하지 않아요", async () => {
  const h = harness();
  h.failStart();
  await h.player.idle();
  await h.player.idle();

  expect(h.calls).toEqual(["start:재즈"]);
  expect(h.player.status().error).toContain("배경 음악을 시작하지 못했어요");
  await expect(h.player.startNow()).rejects.toThrow("배경 음악을 시작하지");
});

test("배경 기능이 없는 재생 방식은 신청곡을 막지 않아요", async () => {
  const player = new BackgroundPlayer(null, {
    read: () => ({ ...DEFAULT_BACKGROUND, enabled: true, playlist: "재즈" }),
  });

  await player.idle();
  expect(await player.beforeRequest()).toBe(true);
  expect(player.status()).toMatchObject({ available: false, active: false });
  await expect(player.startNow()).rejects.toThrow("지원하지 않아요");
});
