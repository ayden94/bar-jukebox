import { afterEach, expect, test } from "bun:test";
import { type BusEvent, onChange } from "../shared/bus";
import type { Song } from "../shared/types";
import type { QueueRepository, StoredNowPlaying } from "./queue.repository";
import { QueueService } from "./queue.service";

function memoryRepository(): QueueRepository {
  let queued: Song[] = [];
  let played: Song[] = [];
  let current: StoredNowPlaying | null = null;
  return {
    loadQueue: async () => [...queued],
    loadHistory: async () => [...played],
    loadNowPlaying: async () => current,
    insertQueueSong: async (song) => {
      queued.push(song);
    },
    removeQueueSong: async (id) => {
      queued = queued.filter((song) => song.id !== id);
    },
    replaceQueuePositions: async (songs) => {
      queued = [...songs];
    },
    takeAndStart: async (song, startedAt) => {
      queued = queued.filter((entry) => entry.id !== song.id);
      current = { song, startedAt };
    },
    finishNowPlaying: async (song, result, max) => {
      if (result === "done") played = [song, ...played].slice(0, max);
      current = null;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    trackId: id.charCodeAt(0),
    trackName: "테스트 곡",
    artistName: "테스트 가수",
    artworkUrl: "",
    albumUrl: "music://test",
    trackNumber: 1,
    durationSec: 200,
    requestedBy: "테이블 1",
    deviceId: id,
    tableId: null,
    isStaff: false,
    requestedAt: 123,
    ...overrides,
  };
}

let events: BusEvent[] | null = null;
onChange((event) => events?.push(event));
afterEach(() => {
  events = null;
});

test("기기와 트랙 활성 여부는 대기 중과 재생 중을 모두 세요", async () => {
  const queue = new QueueService(memoryRepository());
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  expect(queue.deviceHasActive("a")).toBe(true);
  expect(queue.deviceHasActive("c")).toBe(false);
  expect(queue.trackIsActive(97)).toBe(true);
  await queue.takeAndStart();
  expect(queue.deviceHasActive("a")).toBe(true);
  expect(queue.trackIsActive(97)).toBe(true);
  await queue.finishNowPlaying("done", "a");
  expect(queue.deviceHasActive("a")).toBe(false);
  expect(queue.deviceHasActive("b")).toBe(true);
  expect(queue.trackIsActive(97)).toBe(false);
});

test("본인 곡만 취소할 수 있어요", async () => {
  const queue = new QueueService(memoryRepository());
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  expect(await queue.removeOwnedFromQueue("a", "b")).toBe(false);
  expect(await queue.removeOwnedFromQueue("b", "a")).toBe(false);
  expect(await queue.removeOwnedFromQueue("a", "a")).toBe(true);
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual(["b"]);
});

test("기기 상한은 저장과 같은 순서로 검사해요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  const limits = { maxPerDevice: 1, maxPerTable: 0 };
  const results = await Promise.all([
    queue.enqueue(song("a", { deviceId: "device" }), limits),
    queue.enqueue(song("b", { deviceId: "device" }), limits),
  ]);
  expect(results).toEqual([null, "device-limit"]);
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual(["a"]);
});

test("동시 신청도 테이블 상한과 중복 트랙을 넘지 못해요", async () => {
  const queue = new QueueService(memoryRepository());
  expect(
    await Promise.all([
      queue.enqueue(song("a", { tableId: 7 }), {
        maxPerDevice: 0,
        maxPerTable: 1,
      }),
      queue.enqueue(song("b", { tableId: 7 }), {
        maxPerDevice: 0,
        maxPerTable: 1,
      }),
      queue.enqueue(song("c", { trackId: 97 }), {
        maxPerDevice: 0,
        maxPerTable: 0,
      }),
    ]),
  ).toEqual([null, "table-limit", "duplicate-track"]);
});

test("테이블 상한에는 재생 중인 곡도 포함해요", async () => {
  const queue = new QueueService(memoryRepository());
  const limits = { maxPerDevice: 0, maxPerTable: 2 };
  await queue.enqueue(song("a", { tableId: 7 }), limits);
  await queue.enqueue(song("b", { tableId: 7 }), limits);
  await queue.takeAndStart();
  expect(await queue.enqueue(song("c", { tableId: 7 }), limits)).toBe(
    "table-limit",
  );
  expect(await queue.enqueue(song("d", { tableId: 8 }), limits)).toBeNull();
});

test("상한 0은 무제한이고 바텐더는 상한과 중복 검사를 건너뛰어요", async () => {
  const queue = new QueueService(memoryRepository());
  const limits = { maxPerDevice: 0, maxPerTable: 0 };
  await queue.enqueue(song("a", { deviceId: "d", tableId: 1 }), limits);
  expect(
    await queue.enqueue(song("b", { deviceId: "d", tableId: 1 }), limits),
  ).toBeNull();
  expect(
    await queue.enqueue(
      song("c", { deviceId: "d", tableId: 1, trackId: 97, isStaff: true }),
    ),
  ).toBeNull();
});

test("순서 변경은 모든 곡을 보존하고 중복 식별자를 무시해요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  await Promise.all([
    queue.enqueue(song("a")),
    queue.enqueue(song("b")),
    queue.enqueue(song("c")),
  ]);
  await queue.reorder(["c", "c", "없는 곡", "a"]);
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual([
    "c",
    "a",
    "b",
  ]);
  expect(await repo.loadQueue()).toEqual(queue.snapshot().queue);
});

test("완료된 곡만 히스토리에 남기고 실패한 곡은 지워요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  await queue.takeAndStart();
  expect(await queue.finishNowPlaying("done", "a")).toBe(true);
  await queue.takeAndStart();
  expect(await queue.finishNowPlaying("failed", "b")).toBe(true);
  expect(queue.snapshot().history.map((entry) => entry.id)).toEqual(["a"]);
  expect(await repo.loadHistory()).toEqual(queue.snapshot().history);
  expect(await repo.loadNowPlaying()).toBeNull();
});

test("복원과 스냅샷은 큐 순서를 보존해요", () => {
  const queue = new QueueService(memoryRepository());
  queue.hydrate({
    nowPlaying: null,
    queue: [song("b"), song("a")],
    history: [],
  });
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual(["b", "a"]);
});

test("진행률은 반올림하고 이전 곡의 갱신은 무시해요", async () => {
  const queue = new QueueService(memoryRepository());
  await queue.enqueue(song("a"));
  await queue.takeAndStart();
  queue.updateProgress(10.4, 200, "a");
  expect(queue.snapshot().nowPlaying?.positionSec).toBe(10);
  queue.updateProgress(10.9, 200, "a");
  expect(queue.snapshot().nowPlaying?.positionSec).toBe(11);
  queue.updateProgress(50, 200, "이전 곡");
  expect(queue.snapshot().nowPlaying?.positionSec).toBe(11);
  await queue.finishNowPlaying("done", "a");
  queue.updateProgress(50, 200, "a");
  expect(queue.snapshot().nowPlaying).toBeNull();
});

test("저장이 끝나기 전에는 메모리와 이벤트를 바꾸지 않아요", async () => {
  const repo = memoryRepository();
  const entered = deferred<void>();
  const release = deferred<void>();
  const insert = repo.insertQueueSong;
  repo.insertQueueSong = async (entry) => {
    entered.resolve();
    await release.promise;
    await insert(entry);
  };
  const queue = new QueueService(repo);
  events = [];
  const pending = queue.enqueue(song("a"));
  await entered.promise;
  expect(queue.snapshot().queue).toEqual([]);
  expect(events).toEqual([]);
  release.resolve();
  await pending;
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual(["a"]);
  expect(events).toEqual(["mutate"]);
});

test("저장 실패를 호출자에게 전달하고 뒤의 신청은 계속 처리해요", async () => {
  const repo = memoryRepository();
  const insert = repo.insertQueueSong;
  repo.insertQueueSong = async (entry) => {
    if (entry.id === "a") throw new Error("저장 실패");
    await insert(entry);
  };
  const queue = new QueueService(repo);
  events = [];
  const failed = expect(queue.enqueue(song("a"))).rejects.toThrow("저장 실패");
  const next = queue.enqueue(song("b", { deviceId: "a" }));
  await failed;
  expect(await next).toBeNull();
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual(["b"]);
  expect(await repo.loadQueue()).toEqual(queue.snapshot().queue);
  expect(events).toEqual(["mutate"]);
});

test("재생 전환 저장 실패는 큐와 현재 곡을 그대로 두어요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  await queue.enqueue(song("a"));
  repo.takeAndStart = async () => {
    throw new Error("시작 실패");
  };
  const before = queue.snapshot();
  events = [];
  await expect(queue.takeAndStart()).rejects.toThrow("시작 실패");
  expect(queue.snapshot()).toEqual(before);
  expect(events).toEqual([]);
});

test("완료 저장 실패는 재생 중과 히스토리를 그대로 두어요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  await queue.enqueue(song("a"));
  await queue.takeAndStart();
  const finish = repo.finishNowPlaying;
  repo.finishNowPlaying = async () => {
    throw new Error("완료 실패");
  };
  const before = queue.snapshot();
  events = [];
  await expect(queue.finishNowPlaying("done", "a")).rejects.toThrow(
    "완료 실패",
  );
  expect(queue.snapshot()).toEqual(before);
  expect(events).toEqual([]);
  repo.finishNowPlaying = finish;
  expect(await queue.finishNowPlaying("done", "a")).toBe(true);
});

test("삭제와 순서 변경 저장 실패도 메모리와 이벤트를 남기지 않아요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  repo.removeQueueSong = async () => {
    throw new Error("삭제 실패");
  };
  repo.replaceQueuePositions = async () => {
    throw new Error("정렬 실패");
  };
  const before = queue.snapshot();
  events = [];
  await expect(queue.removeOwnedFromQueue("a", "a")).rejects.toThrow(
    "삭제 실패",
  );
  await expect(queue.reorder(["b"])).rejects.toThrow("정렬 실패");
  expect(queue.snapshot()).toEqual(before);
  expect(events).toEqual([]);
});

test("동시 삭제·추가·정렬·재생은 호출 순서대로 저장해요", async () => {
  const repo = memoryRepository();
  const queue = new QueueService(repo);
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  await queue.enqueue(song("c"));
  const entered = deferred<void>();
  const release = deferred<void>();
  const remove = repo.removeQueueSong;
  repo.removeQueueSong = async (id) => {
    entered.resolve();
    await release.promise;
    await remove(id);
  };
  const removing = queue.removeFromQueue("a");
  await entered.promise;
  const adding = queue.enqueue(song("d"));
  const reordering = queue.reorder(["d", "c"]);
  const starting = queue.takeAndStart();
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  release.resolve();
  await Promise.all([removing, adding, reordering]);
  expect((await starting)?.id).toBe("d");
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual(["c", "b"]);
  expect(await repo.loadQueue()).toEqual(queue.snapshot().queue);
  expect((await repo.loadNowPlaying())?.song.id).toBe("d");
});

test("이전 곡의 완료와 건너뛰기는 다음 곡을 지우지 않아요", async () => {
  const queue = new QueueService(memoryRepository());
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  await queue.takeAndStart();
  const results = await Promise.all([
    queue.finishNowPlaying("failed", "a"),
    queue.takeAndStart(),
    queue.finishNowPlaying("done", "a"),
    queue.finishNowPlaying("failed", "a"),
  ]);
  expect(results[0]).toBe(true);
  expect(results[2]).toBe(false);
  expect(results[3]).toBe(false);
  expect(queue.nowPlayingSong()?.id).toBe("b");
  expect(queue.snapshot().history).toEqual([]);
  expect(await queue.takeAndStart()).toBeNull();
});
