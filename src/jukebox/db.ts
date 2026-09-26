import { type Client, createClient } from "@libsql/client";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import { history, nowPlaying, queue, settings, tables } from "./schema";
import type { JukeboxState, Song } from "./types";

export type TableRow = {
  id: number;
  label: string;
  secret: string;
  createdAt: number;
};

// libsql 클라이언트: file: URL은 프로세스 CWD 기준이라 서버는 repo 루트에서 실행한다.
export const libsqlClient: Client = createClient({
  url: "file:jukebox.sqlite",
});
export const database = drizzle(libsqlClient);

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    secret TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS queue (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS now_playing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    started_at INTEGER NOT NULL
  );
`;

export async function initDatabase(): Promise<void> {
  await libsqlClient.execute("PRAGMA journal_mode = WAL;");
  await libsqlClient.executeMultiple(SCHEMA_DDL);
}

function parseSong(json: string): Song | null {
  try {
    return JSON.parse(json) as Song;
  } catch {
    return null;
  }
}

export async function loadState(): Promise<JukeboxState> {
  const settingRows = await database.select().from(settings);
  const pausedRow = settingRows.find((row) => row.key === "requests_paused");
  const noticeRow = settingRows.find((row) => row.key === "notice");
  const queueRows = await database
    .select()
    .from(queue)
    .orderBy(asc(queue.position));
  const historyRows = await database
    .select()
    .from(history)
    .orderBy(asc(history.position));
  const npRows = await database
    .select()
    .from(nowPlaying)
    .where(eq(nowPlaying.id, 1));
  const npRow = npRows[0];

  const nowPlayingSong = npRow ? parseSong(npRow.data) : null;
  return {
    nowPlaying: nowPlayingSong
      ? {
          song: nowPlayingSong,
          startedAt: Date.now(),
          status: "playing",
          positionSec: 0,
          durationSec: null,
        }
      : null,
    queue: queueRows
      .map((row) => parseSong(row.data))
      .filter((song): song is Song => song !== null),
    history: historyRows
      .map((row) => parseSong(row.data))
      .filter((song): song is Song => song !== null),
    requestsPaused: pausedRow?.value === "1",
    notice: noticeRow?.value ?? "",
  };
}

async function rewriteSnapshot(snapshot: JukeboxState): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(settings);
    await tx.insert(settings).values([
      {
        key: "requests_paused",
        value: snapshot.requestsPaused ? "1" : "0",
      },
      { key: "notice", value: snapshot.notice },
    ]);

    await tx.delete(queue);
    if (snapshot.queue.length > 0) {
      await tx.insert(queue).values(
        snapshot.queue.map((song, index) => ({
          id: song.id,
          data: JSON.stringify(song),
          position: index,
        })),
      );
    }

    await tx.delete(history);
    if (snapshot.history.length > 0) {
      await tx.insert(history).values(
        snapshot.history.map((song, index) => ({
          id: song.id,
          data: JSON.stringify(song),
          position: index,
        })),
      );
    }

    await tx.delete(nowPlaying);
    if (snapshot.nowPlaying) {
      await tx.insert(nowPlaying).values({
        id: 1,
        data: JSON.stringify(snapshot.nowPlaying.song),
        startedAt: snapshot.nowPlaying.startedAt,
      });
    }
  });
}

// 연속 mutate 사이에 쓰기 순서가 뒤섞이지 않도록 직렬화한다.
let writeChain: Promise<void> = Promise.resolve();

export function saveSnapshot(snapshot: JukeboxState): Promise<void> {
  const task = writeChain.then(() => rewriteSnapshot(snapshot));
  writeChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export async function listTables(): Promise<TableRow[]> {
  const rows = await database.select().from(tables).orderBy(asc(tables.id));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    secret: row.secret,
    createdAt: row.createdAt,
  }));
}

export async function getTable(id: number): Promise<TableRow | null> {
  const rows = await database
    .select()
    .from(tables)
    .where(eq(tables.id, id))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        label: row.label,
        secret: row.secret,
        createdAt: row.createdAt,
      }
    : null;
}

export async function createTable(
  label: string,
  secret: string,
): Promise<TableRow> {
  const inserted = await database
    .insert(tables)
    .values({ label, secret, createdAt: Date.now() })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("table insert returned no row");
  return {
    id: row.id,
    label: row.label,
    secret: row.secret,
    createdAt: row.createdAt,
  };
}

export async function deleteTable(id: number): Promise<boolean> {
  const deleted = await database
    .delete(tables)
    .where(eq(tables.id, id))
    .returning({ id: tables.id });
  return deleted.length > 0;
}
