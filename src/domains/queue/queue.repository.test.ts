import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import type { Song } from "../shared/types";
import { DrizzleQueueRepository } from "./queue.repository";

async function makeRepository(): Promise<DrizzleQueueRepository> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SCHEMA_DDL);
  return new DrizzleQueueRepository(drizzle(client));
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

test("대기열 저장 후 복원은 순서를 보존한다", async () => {
  const repo = await makeRepository();
  await repo.insertQueueSong(song({ id: "q1" }), 0);
  await repo.insertQueueSong(song({ id: "q2" }), 1);
  await repo.insertQueueSong(song({ id: "q3" }), 2);

  const loaded = await repo.loadQueue();
  expect(loaded.map((s) => s.id)).toEqual(["q1", "q2", "q3"]);
});

test("removeQueueSong는 해당 곡만 지운다", async () => {
  const repo = await makeRepository();
  await repo.insertQueueSong(song({ id: "q1" }), 0);
  await repo.insertQueueSong(song({ id: "q2" }), 1);
  await repo.removeQueueSong("q1");

  const loaded = await repo.loadQueue();
  expect(loaded.map((s) => s.id)).toEqual(["q2"]);
});

test("replaceQueuePositions는 위치를 다시 기록한다", async () => {
  const repo = await makeRepository();
  const a = song({ id: "a" });
  const b = song({ id: "b" });
  const c = song({ id: "c" });
  await repo.insertQueueSong(a, 0);
  await repo.insertQueueSong(b, 1);
  await repo.insertQueueSong(c, 2);

  await repo.replaceQueuePositions([c, a, b]);
  const loaded = await repo.loadQueue();
  expect(loaded.map((s) => s.id)).toEqual(["c", "a", "b"]);
});

test("재생중 곡은 저장·삭제 후 복원된다", async () => {
  const repo = await makeRepository();
  const playing = song({ id: "np" });
  await repo.setNowPlaying(playing, 12345);

  const stored = await repo.loadNowPlaying();
  expect(stored?.song.id).toBe("np");
  expect(stored?.startedAt).toBe(12345);

  await repo.clearNowPlaying();
  expect(await repo.loadNowPlaying()).toBeNull();
});

test("prependHistory는 최신 곡을 앞에 두고 최대 개수를 유지한다", async () => {
  const repo = await makeRepository();
  await repo.prependHistory(song({ id: "h1" }), 3);
  await repo.prependHistory(song({ id: "h2" }), 3);
  await repo.prependHistory(song({ id: "h3" }), 3);
  await repo.prependHistory(song({ id: "h4" }), 3);

  const loaded = await repo.loadHistory();
  expect(loaded.map((s) => s.id)).toEqual(["h4", "h3", "h2"]);
});

test("설정 저장 후 복원", async () => {
  const repo = await makeRepository();
  await repo.setNowPlaying(song({ id: "x" }), 1);
  await repo.clearNowPlaying();
  expect(await repo.loadNowPlaying()).toBeNull();
  expect(await repo.loadQueue()).toEqual([]);
  expect(await repo.loadHistory()).toEqual([]);
});
