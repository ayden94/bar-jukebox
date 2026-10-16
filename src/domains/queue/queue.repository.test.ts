import { afterEach, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import type { Song } from "../shared/types";
import { PersistedSongError } from "./persisted-song";
import { DrizzleQueueRepository } from "./queue.repository";
import { QueueService } from "./queue.service";

const clients: Client[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(SCHEMA_DDL);
  const repo = new DrizzleQueueRepository(drizzle(client));
  return { client, repo, service: new QueueService(repo) };
}

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    formatVersion: 1,
    id,
    ref: { providerId: "test-provider", trackId: id },
    title: "테스트 곡",
    artist: "테스트 가수",
    artwork: null,
    sourceUrl: null,
    durationSec: 200,
    requestedBy: "바텐더",
    deviceId: null,
    tableId: null,
    isStaff: true,
    requestedAt: 123,
    ...overrides,
  };
}

test("대기열 저장 후 복원은 순서를 보존해요", async () => {
  const { repo } = await fixture();
  await Promise.all([
    repo.insertQueueSong(song("a")),
    repo.insertQueueSong(song("b")),
    repo.insertQueueSong(song("c")),
  ]);
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("삭제는 남은 곡의 위치 공백을 없애요", async () => {
  const { repo, client } = await fixture();
  await repo.insertQueueSong(song("a"));
  await repo.insertQueueSong(song("b"));
  await repo.insertQueueSong(song("c"));
  await repo.removeQueueSong("a");
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual(["b", "c"]);
  expect(
    (
      await client.execute("SELECT position FROM queue ORDER BY position")
    ).rows.map((row) => row.position),
  ).toEqual([0, 1]);
});

test("예전 위치 공백이 있는 큐에도 새 곡은 마지막에 들어가요", async () => {
  const { repo, client } = await fixture();
  for (const [id, position] of [
    ["c", 2],
    ["d", 3],
  ] as const) {
    await client.execute({
      sql: "INSERT INTO queue (id, data, position) VALUES (?, ?, ?)",
      args: [id, JSON.stringify(song(id)), position],
    });
  }
  await repo.insertQueueSong(song("e"));
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual([
    "c",
    "d",
    "e",
  ]);
});

test("서비스에서 앞의 두 곡을 지운 뒤 추가해도 복원 순서가 같아요", async () => {
  const { repo, service } = await fixture();
  await Promise.all(
    ["a", "b", "c", "d"].map((id) => service.enqueue(song(id))),
  );
  await Promise.all([
    service.removeFromQueue("a"),
    service.removeFromQueue("b"),
    service.enqueue(song("e")),
  ]);
  const restored = new QueueService(repo);
  restored.hydrate({
    nowPlaying: null,
    history: await repo.loadHistory(),
    queue: await repo.loadQueue(),
  });
  expect(restored.snapshot()).toEqual(service.snapshot());
  expect(restored.snapshot().queue.map((entry) => entry.id)).toEqual([
    "c",
    "d",
    "e",
  ]);
});

test("순서 변경은 위치를 다시 기록하고 실패하면 원래 큐를 복원해요", async () => {
  const { repo } = await fixture();
  const a = song("a");
  const b = song("b");
  await repo.insertQueueSong(a);
  await repo.insertQueueSong(b);
  await repo.replaceQueuePositions([b, a]);
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual(["b", "a"]);
  await expect(repo.replaceQueuePositions([a, a])).rejects.toThrow();
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual(["b", "a"]);
});

test("시작 전환은 큐 삭제와 재생 중 삽입을 함께 저장해요", async () => {
  const { repo, client } = await fixture();
  const a = song("a");
  await repo.insertQueueSong(a);
  await repo.insertQueueSong(song("b"));
  await repo.takeAndStart(a, 12345);
  expect(await repo.loadNowPlaying()).toEqual({ song: a, startedAt: 12345 });
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual(["b"]);
  expect(
    (await client.execute("SELECT position FROM queue")).rows[0]?.position,
  ).toBe(0);
});

test("시작 삽입 실패는 삭제한 큐를 롤백하고 재시도할 수 있어요", async () => {
  const { repo, client, service } = await fixture();
  await service.enqueue(song("a"));
  await service.enqueue(song("b"));
  await client.execute(
    "CREATE TRIGGER fail_start BEFORE INSERT ON now_playing BEGIN SELECT RAISE(ABORT, '시작 실패'); END",
  );
  const before = service.snapshot();
  await expect(service.takeAndStart()).rejects.toThrow();
  expect(service.snapshot()).toEqual(before);
  expect(await repo.loadQueue()).toEqual(before.queue);
  expect(await repo.loadNowPlaying()).toBeNull();
  await client.execute("DROP TRIGGER fail_start");
  expect((await service.takeAndStart())?.id).toBe("a");
  expect((await repo.loadNowPlaying())?.song.id).toBe("a");
});

test("위치 재기록 실패는 삭제한 곡도 롤백해요", async () => {
  const { repo, client, service } = await fixture();
  await service.enqueue(song("a"));
  await service.enqueue(song("b"));
  await client.execute(
    "CREATE TRIGGER fail_compact BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, '위치 저장 실패'); END",
  );
  const before = service.snapshot();
  await expect(service.removeFromQueue("a")).rejects.toThrow();
  expect(service.snapshot()).toEqual(before);
  expect(await repo.loadQueue()).toEqual(before.queue);
});

test("완료 전환은 최신 순서와 히스토리 상한을 함께 저장해요", async () => {
  const { repo } = await fixture();
  for (const id of ["a", "b", "c", "d"]) {
    const entry = song(id);
    await repo.insertQueueSong(entry);
    await repo.takeAndStart(entry, 1);
    await repo.finishNowPlaying(entry, "done", 3);
  }
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual([
    "d",
    "c",
    "b",
  ]);
  expect(await repo.loadNowPlaying()).toBeNull();
  const failed = song("e");
  await repo.insertQueueSong(failed);
  await repo.takeAndStart(failed, 2);
  await repo.finishNowPlaying(failed, "failed", 3);
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual([
    "d",
    "c",
    "b",
  ]);
  expect(await repo.loadNowPlaying()).toBeNull();
});

test("재생 중 삭제 실패는 앞서 쓴 히스토리까지 롤백해요", async () => {
  const { repo, client, service } = await fixture();
  await service.enqueue(song("a"));
  await service.takeAndStart();
  await service.finishNowPlaying("done", "a");
  await service.enqueue(song("b"));
  await service.takeAndStart();
  await client.execute(
    "CREATE TRIGGER fail_finish BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '완료 실패'); END",
  );
  const before = service.snapshot();
  await expect(service.finishNowPlaying("done", "b")).rejects.toThrow();
  expect(service.snapshot()).toEqual(before);
  expect(await repo.loadHistory()).toEqual(before.history);
  expect((await repo.loadNowPlaying())?.song).toEqual(before.nowPlaying?.song);
  await client.execute("DROP TRIGGER fail_finish");
  expect(await service.finishNowPlaying("done", "b")).toBe(true);
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual([
    "b",
    "a",
  ]);
  expect(await repo.loadNowPlaying()).toBeNull();
});

test("실제 SQLite에서도 동시 신청 상한과 재생 전환 순서를 지켜요", async () => {
  const { repo, service } = await fixture();
  const limits = { maxPerDevice: 1, maxPerTable: 5 };
  const guest = { isStaff: false, deviceId: "같은 기기", tableId: 1 };
  expect(
    await Promise.all([
      service.enqueue(song("a", guest), limits),
      service.enqueue(song("b", guest), limits),
    ]),
  ).toEqual([null, "device-limit"]);
  await service.enqueue(song("c"));
  const [playing, blocked] = await Promise.all([
    service.takeAndStart(),
    service.takeAndStart(),
  ]);
  expect(playing?.id).toBe("a");
  expect(blocked).toBeNull();
  await Promise.all([
    service.finishNowPlaying("failed", "a"),
    service.takeAndStart(),
    service.finishNowPlaying("done", "a"),
  ]);
  expect(service.nowPlayingSong()?.id).toBe("c");
  expect((await repo.loadNowPlaying())?.song.id).toBe("c");
  expect(await repo.loadHistory()).toEqual([]);
  expect(await repo.loadQueue()).toEqual([]);
});

for (const table of ["queue", "history", "now_playing"] as const) {
  for (const data of ["{비밀-원문", "null", "[]", '{"secret":"비밀-원문"}']) {
    test(`${table} 복원은 잘못된 JSON이나 구조를 행 정보가 있는 오류로 알려요: ${data}`, async () => {
      const { client, repo } = await fixture();
      const rowId = table === "now_playing" ? 1 : "a";
      await client.execute({
        sql: `INSERT INTO ${table} (id, data, ${table === "now_playing" ? "started_at" : "position"}) VALUES (?, ?, 0)`,
        args: [rowId, data],
      });
      const load = {
        queue: () => repo.loadQueue(),
        history: () => repo.loadHistory(),
        now_playing: () => repo.loadNowPlaying(),
      }[table];

      const error = await load().catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(PersistedSongError);
      expect(error).toMatchObject({ table, rowId });
      expect(String(error)).not.toContain("비밀-원문");
      expect(error).not.toHaveProperty("cause");
    });
  }
}

const invalidFields: Record<keyof Song, unknown[]> = {
  formatVersion: [0, 2, "1", null],
  id: ["", 1, "다른 행"],
  ref: [
    null,
    [],
    {},
    { providerId: "", trackId: "a" },
    { providerId: "test", trackId: 97 },
    { providerId: "test", trackId: "" },
  ],
  title: ["", " ", null],
  artist: ["", null],
  artwork: [
    1,
    {},
    { providerId: "", artworkId: "a" },
    { providerId: "test", artworkId: "" },
  ],
  sourceUrl: ["", 1],
  durationSec: [-1, "200"],
  requestedBy: ["", null],
  deviceId: ["", 1],
  tableId: [0, -1, 1.5, "1"],
  isStaff: [null, "true", 1],
  requestedAt: [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "123"],
};

for (const [field, values] of Object.entries(invalidFields)) {
  for (const value of values) {
    test(`대기열 복원은 ${field}의 잘못된 값 ${JSON.stringify(value)}을 거부해요`, async () => {
      const { client, repo } = await fixture();
      await client.execute({
        sql: "INSERT INTO queue (id, data, position) VALUES ('a', ?, 0)",
        args: [JSON.stringify({ ...song("a"), [field]: value })],
      });

      await expect(repo.loadQueue()).rejects.toBeInstanceOf(PersistedSongError);
    });
  }
  test(`대기열 복원은 누락된 ${field} 필드를 거부해요`, async () => {
    const { client, repo } = await fixture();
    const stored: Record<string, unknown> = { ...song("a") };
    delete stored[field];
    await client.execute({
      sql: "INSERT INTO queue (id, data, position) VALUES ('a', ?, 0)",
      args: [JSON.stringify(stored)],
    });

    await expect(repo.loadQueue()).rejects.toBeInstanceOf(PersistedSongError);
  });
}

test("복원은 짧은 식별자와 손님 소유권과 null 길이 및 시각을 보존해요", async () => {
  const { repo } = await fixture();
  const entry = song("a", {
    deviceId: "기기",
    tableId: 1,
    isStaff: false,
    durationSec: null,
    requestedAt: 0,
  });
  await repo.insertQueueSong(entry);

  expect(await repo.loadQueue()).toEqual([entry]);
  await repo.takeAndStart(entry, 0);
  expect(await repo.loadNowPlaying()).toEqual({ song: entry, startedAt: 0 });
  await repo.finishNowPlaying(entry, "done", 1);
  expect(await repo.loadHistory()).toEqual([entry]);
});

test("복원은 JSON 숫자의 오버플로를 유효한 길이로 받지 않아요", async () => {
  const { client, repo } = await fixture();
  await client.execute({
    sql: "INSERT INTO queue (id, data, position) VALUES ('a', ?, 0)",
    args: [
      JSON.stringify(song("a")).replace(
        '"durationSec":200',
        '"durationSec":1e309',
      ),
    ],
  });

  await expect(repo.loadQueue()).rejects.toBeInstanceOf(PersistedSongError);
});

test("재생 중 복원은 잘못된 시작 시각을 명시적 오류로 알려요", async () => {
  const { client, repo } = await fixture();
  await client.execute({
    sql: "INSERT INTO now_playing (id, data, started_at) VALUES (1, ?, -1)",
    args: [JSON.stringify(song("a"))],
  });

  await expect(repo.loadNowPlaying()).rejects.toMatchObject({
    table: "now_playing",
    rowId: 1,
    code: "invalid-started-at",
  });
});

test("히스토리 재작성은 상한 밖의 손상된 행도 거부하고 원본과 재생 중 곡을 보존해요", async () => {
  const { client, repo } = await fixture();
  const entry = song("a");
  await repo.insertQueueSong(entry);
  await repo.takeAndStart(entry, 123);
  await client.execute({
    sql: "INSERT INTO history (id, data, position) VALUES ('b', ?, 0), ('c', ?, 1)",
    args: [JSON.stringify(song("b")), '{"secret":"유실하면 안 되는 원문"}'],
  });
  const before = await client.execute(
    "SELECT * FROM history ORDER BY position",
  );

  await expect(repo.finishNowPlaying(entry, "done", 1)).rejects.toMatchObject({
    table: "history",
    rowId: "c",
  });

  expect(
    (await client.execute("SELECT * FROM history ORDER BY position")).rows,
  ).toEqual(before.rows);
  expect(await repo.loadNowPlaying()).toEqual({ song: entry, startedAt: 123 });
});
