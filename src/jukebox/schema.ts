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
