import { expect, test } from "bun:test";
import { state } from "./state";
import type { JukeboxState, Song } from "./types";

function emptyState(): JukeboxState {
  return {
    nowPlaying: null,
    queue: [],
    history: [],
    requestsPaused: false,
    notice: "",
  };
}

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: crypto.randomUUID(),
    trackId: 1,
    trackName: "Test Song",
    artistName: "Test Artist",
    artworkUrl: "",
    albumUrl: "music://test",
    trackNumber: 1,
    durationSec: 200,
    requestedBy: "테이블 1",
    deviceId: "device-1",
    isStaff: false,
    requestedAt: Date.now(),
    ...overrides,
  };
}

test("기기당 큐+재생중 1곡 제한", () => {
  state.hydrate(emptyState());
  state.enqueue(song({ id: "a", deviceId: "device-1" }));
  expect(state.deviceHasActive("device-1")).toBe(true);
  expect(state.deviceHasActive("device-2")).toBe(false);

  state.setNowPlaying(song({ id: "b", deviceId: "device-2" }));
  expect(state.deviceHasActive("device-2")).toBe(true);

  state.finishNowPlaying("done");
  expect(state.deviceHasActive("device-2")).toBe(false);
  expect(state.deviceHasActive("device-1")).toBe(true);
});

test("같은 트랙 중복 감지", () => {
  state.hydrate(emptyState());
  state.enqueue(song({ trackId: 42 }));
  expect(state.trackIsActive(42)).toBe(true);
  expect(state.trackIsActive(43)).toBe(false);

  state.setNowPlaying(song({ id: "np", trackId: 99 }));
  expect(state.trackIsActive(99)).toBe(true);
});

test("본인 곡만 취소 가능", () => {
  state.hydrate(emptyState());
  state.enqueue(song({ id: "mine", deviceId: "d1" }));
  state.enqueue(song({ id: "others", deviceId: "d2" }));

  expect(state.removeOwnedFromQueue("mine", "d2")).toBe(false);
  expect(state.removeOwnedFromQueue("others", "d1")).toBe(false);
  expect(state.removeOwnedFromQueue("mine", "d1")).toBe(true);
  expect(state.snapshot().queue.map((s) => s.id)).toEqual(["others"]);
});

test("reorder는 모든 곡을 보존하고 지정 순서를 앞으로 당긴다", () => {
  state.hydrate(emptyState());
  state.enqueue(song({ id: "a" }));
  state.enqueue(song({ id: "b" }));
  state.enqueue(song({ id: "c" }));

  state.reorder(["c", "a"]);
  expect(state.snapshot().queue.map((s) => s.id)).toEqual(["c", "a", "b"]);
});

test("finishNowPlaying은 완료 곡을 히스토리로 옮긴다", () => {
  state.hydrate(emptyState());
  state.setNowPlaying(song({ id: "p1" }));
  state.finishNowPlaying("done");
  let snap = state.snapshot();
  expect(snap.nowPlaying).toBeNull();
  expect(snap.history.map((s) => s.id)).toEqual(["p1"]);

  state.setNowPlaying(song({ id: "p2" }));
  state.finishNowPlaying("failed");
  snap = state.snapshot();
  expect(snap.nowPlaying).toBeNull();
  expect(snap.history.map((s) => s.id)).toEqual(["p1"]);
});

test("hydrate/snapshot 왕복은 설정과 큐 순서를 보존한다", () => {
  const seeded: JukeboxState = {
    ...emptyState(),
    queue: [song({ id: "q2" }), song({ id: "q1" })],
    requestsPaused: true,
    notice: "이벤트 안내",
  };
  state.hydrate(seeded);
  const snap = state.snapshot();
  expect(snap.queue.map((s) => s.id)).toEqual(["q2", "q1"]);
  expect(snap.requestsPaused).toBe(true);
  expect(snap.notice).toBe("이벤트 안내");
  expect(state.isRequestsPaused()).toBe(true);
  expect(state.getNotice()).toBe("이벤트 안내");
});

test("updateProgress는 초 단위로 반올림해 올린다", () => {
  state.hydrate(emptyState());
  state.setNowPlaying(song({ id: "pp", durationSec: 200 }));
  state.updateProgress(10.4, 200);
  expect(state.snapshot().nowPlaying?.positionSec).toBe(10);
  state.updateProgress(10.9, 200);
  expect(state.snapshot().nowPlaying?.positionSec).toBe(11);
  state.finishNowPlaying("done");
  state.updateProgress(50, 200);
  expect(state.snapshot().nowPlaying).toBeNull();
});
