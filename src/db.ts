import { Database } from "bun:sqlite";
import type { JukeboxState, Song } from "./types";

export type TableRow = {
  id: number;
  label: string;
  secret: string;
  createdAt: number;
};

const db = new Database("jukebox.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
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
`);

function parseSong(json: string): Song | null {
  try {
    return JSON.parse(json) as Song;
  } catch {
    return null;
  }
}

export function loadState(): JukeboxState {
  const pausedRow = db
    .query("SELECT value FROM settings WHERE key = 'requests_paused'")
    .get() as { value: string } | null;
  const noticeRow = db
    .query("SELECT value FROM settings WHERE key = 'notice'")
    .get() as { value: string } | null;
  const queueRows = db
    .query("SELECT data FROM queue ORDER BY position")
    .all() as {
    data: string;
  }[];
  const historyRows = db
    .query("SELECT data FROM history ORDER BY position")
    .all() as {
    data: string;
  }[];
  const npRow = db.query("SELECT data FROM now_playing WHERE id = 1").get() as {
    data: string;
  } | null;

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
      .map((r) => parseSong(r.data))
      .filter((s): s is Song => s !== null),
    history: historyRows
      .map((r) => parseSong(r.data))
      .filter((s): s is Song => s !== null),
    requestsPaused: pausedRow?.value === "1",
    notice: noticeRow?.value ?? "",
  };
}

export function saveSnapshot(snapshot: JukeboxState): void {
  const persist = db.transaction((s: JukeboxState) => {
    db.query(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('requests_paused', ?)",
    ).run(s.requestsPaused ? "1" : "0");
    db.query(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('notice', ?)",
    ).run(s.notice);

    db.query("DELETE FROM queue").run();
    const insertQueue = db.query(
      "INSERT INTO queue (id, data, position) VALUES (?, ?, ?)",
    );
    s.queue.forEach((song, index) => {
      insertQueue.run(song.id, JSON.stringify(song), index);
    });

    db.query("DELETE FROM history").run();
    const insertHistory = db.query(
      "INSERT INTO history (id, data, position) VALUES (?, ?, ?)",
    );
    s.history.forEach((song, index) => {
      insertHistory.run(song.id, JSON.stringify(song), index);
    });

    db.query("DELETE FROM now_playing").run();
    if (s.nowPlaying) {
      db.query(
        "INSERT INTO now_playing (id, data, started_at) VALUES (1, ?, ?)",
      ).run(JSON.stringify(s.nowPlaying.song), s.nowPlaying.startedAt);
    }
  });
  persist(snapshot);
}

export function listTables(): TableRow[] {
  const rows = db
    .query("SELECT id, label, secret, created_at FROM tables ORDER BY id")
    .all() as {
    id: number;
    label: string;
    secret: string;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    secret: r.secret,
    createdAt: r.created_at,
  }));
}

export function getTable(id: number): TableRow | null {
  const row = db
    .query("SELECT id, label, secret, created_at FROM tables WHERE id = ?")
    .get(id) as {
    id: number;
    label: string;
    secret: string;
    created_at: number;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    secret: row.secret,
    createdAt: row.created_at,
  };
}

export function createTable(label: string, secret: string): TableRow {
  const createdAt = Date.now();
  const result = db
    .query("INSERT INTO tables (label, secret, created_at) VALUES (?, ?, ?)")
    .run(label, secret, createdAt);
  return { id: Number(result.lastInsertRowid), label, secret, createdAt };
}

export function deleteTable(id: number): boolean {
  const result = db.query("DELETE FROM tables WHERE id = ?").run(id);
  return result.changes > 0;
}
