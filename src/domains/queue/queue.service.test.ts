import { expect, test } from "bun:test";
import type { Song } from "../shared/types";
import type { QueueRepository } from "./queue.repository";
import type { QueueSnapshot } from "./queue.service";
import { QueueService } from "./queue.service";

function memoryRepository(): QueueRepository {
  return {
    loadQueue: async () => [],
    loadHistory: async () => [],
    loadNowPlaying: async () => null,
    insertQueueSong: async () => undefined,
    removeQueueSong: async () => undefined,
    replaceQueuePositions: async () => undefined,
    setNowPlaying: async () => undefined,
    clearNowPlaying: async () => undefined,
    prependHistory: async () => undefined,
  };
}

function emptyQueueState(): QueueSnapshot {
  return { nowPlaying: null, queue: [], history: [] };
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
  const queue = new QueueService(memoryRepository());
  queue.hydrate(emptyQueueState());
  queue.enqueue(song({ id: "a", deviceId: "device-1" }));
  expect(queue.deviceHasActive("device-1")).toBe(true);
  expect(queue.deviceHasActive("device-2")).toBe(false);

  queue.setNowPlaying(song({ id: "b", deviceId: "device-2" }));
  expect(queue.deviceHasActive("device-2")).toBe(true);

  queue.finishNowPlaying("done");
  expect(queue.deviceHasActive("device-2")).toBe(false);
  expect(queue.deviceHasActive("device-1")).toBe(true);
});

test("같은 트랙 중복 감지", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate(emptyQueueState());
  queue.enqueue(song({ trackId: 42 }));
  expect(queue.trackIsActive(42)).toBe(true);
  expect(queue.trackIsActive(43)).toBe(false);

  queue.setNowPlaying(song({ id: "np", trackId: 99 }));
  expect(queue.trackIsActive(99)).toBe(true);
});

test("본인 곡만 취소 가능", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate(emptyQueueState());
  queue.enqueue(song({ id: "mine", deviceId: "d1" }));
  queue.enqueue(song({ id: "others", deviceId: "d2" }));

  expect(queue.removeOwnedFromQueue("mine", "d2")).toBe(false);
  expect(queue.removeOwnedFromQueue("others", "d1")).toBe(false);
  expect(queue.removeOwnedFromQueue("mine", "d1")).toBe(true);
  expect(queue.snapshot().queue.map((s) => s.id)).toEqual(["others"]);
});

test("reorder는 모든 곡을 보존하고 지정 순서를 앞으로 당긴다", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate(emptyQueueState());
  queue.enqueue(song({ id: "a" }));
  queue.enqueue(song({ id: "b" }));
  queue.enqueue(song({ id: "c" }));

  queue.reorder(["c", "a"]);
  expect(queue.snapshot().queue.map((s) => s.id)).toEqual(["c", "a", "b"]);
});

test("finishNowPlaying은 완료 곡을 히스토리로 옮긴다", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate(emptyQueueState());
  queue.setNowPlaying(song({ id: "p1" }));
  queue.finishNowPlaying("done");
  let snap = queue.snapshot();
  expect(snap.nowPlaying).toBeNull();
  expect(snap.history.map((s) => s.id)).toEqual(["p1"]);

  queue.setNowPlaying(song({ id: "p2" }));
  queue.finishNowPlaying("failed");
  snap = queue.snapshot();
  expect(snap.nowPlaying).toBeNull();
  expect(snap.history.map((s) => s.id)).toEqual(["p1"]);
});

test("hydrate/snapshot 왕복은 큐 순서를 보존한다", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate({
    ...emptyQueueState(),
    queue: [song({ id: "q2" }), song({ id: "q1" })],
  });
  const snap = queue.snapshot();
  expect(snap.queue.map((s) => s.id)).toEqual(["q2", "q1"]);
});

test("updateProgress는 초 단위로 반올림해 올린다", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate(emptyQueueState());
  queue.setNowPlaying(song({ id: "pp", durationSec: 200 }));
  queue.updateProgress(10.4, 200);
  expect(queue.snapshot().nowPlaying?.positionSec).toBe(10);
  queue.updateProgress(10.9, 200);
  expect(queue.snapshot().nowPlaying?.positionSec).toBe(11);
  queue.finishNowPlaying("done");
  queue.updateProgress(50, 200);
  expect(queue.snapshot().nowPlaying).toBeNull();
});
