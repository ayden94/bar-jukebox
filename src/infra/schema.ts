import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
`;
