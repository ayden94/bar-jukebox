import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "@libsql/client";
import { DrizzleQueueRepository } from "../domains/queue/queue.repository";
import type { Song } from "../domains/shared/types";
import { createDatabase, type DatabaseConnection, initDatabase } from "./db";
import { SCHEMA_DDL } from "./schema";

const connections: DatabaseConnection[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.client.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function open(url: string): DatabaseConnection {
  const connection = createDatabase(url);
  connections.push(connection);
  return connection;
}

function legacySong(id: string) {
  return {
    id,
    trackId: 9001,
    trackName: "예전 곡",
    artistName: "가수",
    artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg",
    albumUrl: "music://music.apple.com/kr/album/example/9000?i=9001",
    trackNumber: 3,
    durationSec: 210,
    requestedBy: "신청자",
    deviceId: "기기-원본",
    tableId: 7,
    isStaff: false,
    requestedAt: 123,
  };
}

function migratedSong(id: string): Song {
  return {
    formatVersion: 1,
    id,
    ref: { providerId: "apple-music", trackId: "9001" },
    title: "예전 곡",
    artist: "가수",
    durationSec: 210,
    artwork: {
      providerId: "apple-music",
      artworkId: "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg",
    },
    sourceUrl: "https://music.apple.com/song/9001",
    requestedBy: "신청자",
    deviceId: "기기-원본",
    tableId: 7,
    isStaff: false,
    requestedAt: 123,
  };
}

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "jukebox-migration-test-"));
  directories.push(path);
  return path;
}

async function fixture(file = false) {
  const path = file ? join(await directory(), "source.sqlite") : null;
  const connection = open(path ? pathToFileURL(path).href : ":memory:");
  await connection.client.executeMultiple(SCHEMA_DDL);
  await connection.client.batch(
    [
      {
        sql: "INSERT INTO queue VALUES ('b', ?, 9), ('a', ?, 3)",
        args: [
          JSON.stringify(legacySong("b")),
          JSON.stringify(legacySong("a")),
        ],
      },
      {
        sql: "INSERT INTO history VALUES ('h', ?, 5)",
        args: [JSON.stringify(legacySong("h"))],
      },
      {
        sql: "INSERT INTO now_playing VALUES (1, ?, 456)",
        args: [JSON.stringify(legacySong("playing"))],
      },
      "INSERT INTO settings VALUES ('notice', '보존할 설정')",
      "INSERT INTO tables VALUES (7, '테이블', '보존할 비밀', 12)",
    ],
    "write",
  );
  return { connection, client: connection.client, path };
}

async function snapshot(client: Client) {
  const state: Record<string, unknown> = {};
  for (const table of [
    "queue",
    "history",
    "now_playing",
    "settings",
    "tables",
  ]) {
    state[table] = (
      await client.execute(`SELECT * FROM ${table} ORDER BY 1`)
    ).rows;
  }
  state.version = (await client.execute("PRAGMA user_version")).rows;
  return state;
}

test("v1 이전은 요청 소유권과 순서와 시작 시각을 보존하고 재실행해도 같아요", async () => {
  const { connection, client } = await fixture();
  const repo = new DrizzleQueueRepository(connection.database);

  expect(await initDatabase(connection)).toEqual({ backupPath: null });

  expect(await repo.loadQueue()).toEqual([
    migratedSong("a"),
    migratedSong("b"),
  ]);
  expect(await repo.loadHistory()).toEqual([migratedSong("h")]);
  expect(await repo.loadNowPlaying()).toEqual({
    song: migratedSong("playing"),
    startedAt: 456,
  });
  expect(
    (
      await client.execute("SELECT position FROM queue ORDER BY position")
    ).rows.map((row) => row.position),
  ).toEqual([3, 9]);
  expect(
    (await client.execute("SELECT position FROM history")).rows.map(
      (row) => row.position,
    ),
  ).toEqual([5]);
  expect(
    (await client.execute("PRAGMA user_version")).rows[0]?.user_version,
  ).toBe(1);
  const before = await snapshot(client);
  expect(await initDatabase(connection)).toEqual({ backupPath: null });
  expect(await snapshot(client)).toEqual(before);
});

test("파일 이전은 WAL의 구형 데이터를 먼저 백업하고 재시작 후 v1을 복원해요", async () => {
  const { connection, client, path } = await fixture(true);
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA wal_autocheckpoint = 0");
  await client.execute("UPDATE settings SET value = 'WAL에만 있는 설정'");
  const before = await snapshot(client);

  const { backupPath } = await initDatabase(connection);

  expect(backupPath).not.toBeNull();
  expect((await stat(backupPath!)).mode & 0o777).toBe(0o600);
  const backup = open(pathToFileURL(backupPath!).href);
  expect(await snapshot(backup.client)).toEqual(before);
  const after = await snapshot(client);
  connection.client.close();
  connections.splice(connections.indexOf(connection), 1);
  const restarted = open(pathToFileURL(path!).href);
  expect(await initDatabase(restarted)).toEqual({ backupPath: null });
  expect(await snapshot(restarted.client)).toEqual(after);
  expect(
    await new DrizzleQueueRepository(restarted.database).loadNowPlaying(),
  ).toEqual({ song: migratedSong("playing"), startedAt: 456 });
});

for (const corruption of [
  "{비밀 원문",
  JSON.stringify({ ...legacySong("playing"), trackId: "9001" }),
  JSON.stringify({ ...legacySong("playing"), trackId: 9007199254740992 }),
  JSON.stringify({ ...legacySong("playing"), formatVersion: 2 }),
]) {
  test(`v1 이전은 마지막 테이블의 손상 행에서 앞선 변환과 버전을 롤백해요: ${corruption}`, async () => {
    const { connection, client } = await fixture();
    await client.execute({
      sql: "UPDATE now_playing SET data = ?",
      args: [corruption],
    });
    const before = await snapshot(client);

    const failure = await initDatabase(connection).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ table: "now_playing", rowId: 1 });
    expect(String(failure)).not.toContain("비밀 원문");
    expect(await snapshot(client)).toEqual(before);
  });
}

test("v1 이전은 잘못된 기존 시작 시각을 보존한 채 전체 롤백해요", async () => {
  const { connection, client } = await fixture();
  await client.execute("UPDATE now_playing SET started_at = -1");
  const before = await snapshot(client);

  await expect(initDatabase(connection)).rejects.toMatchObject({
    code: "invalid-started-at",
  });

  expect(await snapshot(client)).toEqual(before);
});

test("파일 이전 실패는 원본과 이전 전 백업에 손상된 행까지 그대로 남겨요", async () => {
  const { connection, client, path } = await fixture(true);
  await client.execute({
    sql: "UPDATE history SET data = ?",
    args: ['{"secret":"보존할 손상 원문"}'],
  });
  const before = await snapshot(client);

  await expect(initDatabase(connection)).rejects.toMatchObject({
    table: "history",
    rowId: "h",
  });

  expect(await snapshot(client)).toEqual(before);
  const files = await readdir(join(path!, ".."));
  const backups = files.filter((name) => name.includes(".before-v1-"));
  expect(backups).toHaveLength(1);
  const backup = open(pathToFileURL(join(path!, "..", backups[0]!)).href);
  expect(await snapshot(backup.client)).toEqual(before);
});

test("v1 이전은 중간 SQL 실패를 롤백하고 원인을 고친 뒤 재실행할 수 있어요", async () => {
  const { connection, client } = await fixture();
  await client.execute(
    "CREATE TRIGGER fail_migration BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, '이전 실패'); END",
  );
  const before = await snapshot(client);

  await expect(initDatabase(connection)).rejects.toThrow();

  expect(await snapshot(client)).toEqual(before);
  await client.execute("DROP TRIGGER fail_migration");
  await initDatabase(connection);
  expect(
    await new DrizzleQueueRepository(connection.database).loadQueue(),
  ).toEqual([migratedSong("a"), migratedSong("b")]);
});

test("초기화는 미래 DB 버전을 거부하며 행과 버전과 파일 목록을 바꾸지 않아요", async () => {
  const { connection, client, path } = await fixture(true);
  await client.execute("PRAGMA user_version = 2");
  const before = await snapshot(client);
  const files = await readdir(join(path!, ".."));

  await expect(initDatabase(connection)).rejects.toThrow();

  expect(await snapshot(client)).toEqual(before);
  expect(await readdir(join(path!, ".."))).toEqual(files);
});

test("v1 이전은 이미 저장된 다른 공급자의 활성 곡과 기록을 바꾸지 않아요", async () => {
  const { connection, client } = await fixture();
  const other = (id: string): Song => ({
    ...migratedSong(id),
    ref: { providerId: "other-provider", trackId: "00A:a/B" },
    artwork: { providerId: "other-provider", artworkId: "cover:opaque" },
    durationSec: null,
    sourceUrl: null,
  });
  await client.batch(
    [
      {
        sql: "UPDATE queue SET data = ? WHERE id = 'a'",
        args: [JSON.stringify(other("a"))],
      },
      {
        sql: "UPDATE history SET data = ?",
        args: [JSON.stringify(other("h"))],
      },
      {
        sql: "UPDATE now_playing SET data = ?",
        args: [JSON.stringify(other("playing"))],
      },
    ],
    "write",
  );

  await initDatabase(connection);

  const repo = new DrizzleQueueRepository(connection.database);
  expect(await repo.loadQueue()).toEqual([other("a"), migratedSong("b")]);
  expect(await repo.loadHistory()).toEqual([other("h")]);
  expect(await repo.loadNowPlaying()).toEqual({
    song: other("playing"),
    startedAt: 456,
  });
});

test("새 DB 초기화는 빈 v1 스키마를 만들고 불필요한 백업을 남기지 않아요", async () => {
  const path = join(await directory(), "new.sqlite");
  const connection = open(pathToFileURL(path).href);

  expect(await initDatabase(connection)).toEqual({ backupPath: null });

  expect(
    await new DrizzleQueueRepository(connection.database).loadQueue(),
  ).toEqual([]);
  expect(
    (await connection.client.execute("PRAGMA user_version")).rows[0]
      ?.user_version,
  ).toBe(1);
});

test("DB 모듈 import는 환경 경로나 기본 경로에 파일을 만들지 않아요", async () => {
  const cwd = await directory();
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `await import(${JSON.stringify(`${import.meta.dir}/db.ts`)})`,
    ],
    {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: `file:${join(cwd, "configured.sqlite")}`,
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  );

  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  expect(await readdir(cwd)).toEqual([]);
});
