import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  DurableAttempt,
  DurableCommand,
  PlaybackOwner,
} from "../domains/playback/protocol";

// 기존 SQLite 스키마와 컬럼명을 그대로 유지한다 (기존 jukebox.sqlite 파일과 호환).
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const tables = sqliteTable("tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  secret: text("secret").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const queue = sqliteTable("queue", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  position: integer("position").notNull(),
});

export const history = sqliteTable("history", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  position: integer("position").notNull(),
});

export const nowPlaying = sqliteTable("now_playing", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  startedAt: integer("started_at").notNull(),
});

export const playbackOwner = sqliteTable("playback_owner", {
  id: integer("id").primaryKey(),
  epoch: integer("epoch").notNull(),
  data: text("data", { mode: "json" }).$type<PlaybackOwner>(),
});

export const playbackAttempts = sqliteTable("playback_attempts", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull(),
  ownerEpoch: integer("owner_epoch").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  data: text("data", { mode: "json" }).$type<DurableAttempt>().notNull(),
});

export const playbackCommands = sqliteTable("playback_commands", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull(),
  ownerEpoch: integer("owner_epoch").notNull(),
  data: text("data", { mode: "json" }).$type<DurableCommand>().notNull(),
});

// 클라이언트 없이 스키마를 초기화할 수 있도록 DDL을 함께 내보낸다 (테스트에서 사용).
export const SCHEMA_DDL = `
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
  CREATE TABLE IF NOT EXISTS playback_owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    epoch INTEGER NOT NULL CHECK (epoch >= 0),
    data TEXT
  );
  INSERT OR IGNORE INTO playback_owner (id, epoch, data) VALUES (1, 0, NULL);
  CREATE TABLE IF NOT EXISTS playback_attempts (
    id TEXT PRIMARY KEY,
    song_id TEXT NOT NULL,
    owner_epoch INTEGER NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    data TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS playback_single_active
    ON playback_attempts (active) WHERE active = 1;
  CREATE TABLE IF NOT EXISTS playback_commands (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES playback_attempts(id),
    owner_epoch INTEGER NOT NULL,
    data TEXT NOT NULL
  );
`;
