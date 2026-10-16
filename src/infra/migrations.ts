import type { Client } from "@libsql/client";
import {
  decodePersistedSong,
  isStoredTimestamp,
  PersistedSongError,
} from "../domains/queue/persisted-song";
import type { Song } from "../domains/shared/types";
import { SCHEMA_DDL } from "./schema";

export const SCHEMA_VERSION = 1;

function migrateSong(
  json: string,
  table: "queue" | "history" | "now_playing",
  rowId: string | number,
): Song {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new PersistedSongError(table, rowId, "invalid-json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistedSongError(table, rowId, "invalid-song");
  }
  const old = value as Record<string, unknown>;
  if ("formatVersion" in old) return decodePersistedSong(json, table, rowId);
  if (
    typeof old.trackId !== "number" ||
    !Number.isSafeInteger(old.trackId) ||
    old.trackId <= 0 ||
    typeof old.artworkUrl !== "string" ||
    typeof old.albumUrl !== "string" ||
    !old.albumUrl.startsWith("music://") ||
    old.albumUrl.slice("music://".length).trim().length === 0 ||
    typeof old.trackNumber !== "number" ||
    !Number.isInteger(old.trackNumber) ||
    old.trackNumber < 1 ||
    old.trackNumber > 200 ||
    (old.durationSec !== null &&
      (typeof old.durationSec !== "number" ||
        !Number.isFinite(old.durationSec) ||
        old.durationSec <= 0))
  ) {
    throw new PersistedSongError(table, rowId, "invalid-song");
  }
  return decodePersistedSong(
    JSON.stringify({
      formatVersion: 1,
      id: old.id,
      ref: { providerId: "apple-music", trackId: String(old.trackId) },
      title: old.trackName,
      artist: old.artistName,
      durationSec: old.durationSec,
      artwork: old.artworkUrl
        ? { providerId: "apple-music", artworkId: old.artworkUrl }
        : null,
      sourceUrl: `https://music.apple.com/song/${old.trackId}`,
      requestedBy: old.requestedBy,
      deviceId: old.deviceId,
      tableId: old.tableId,
      isStaff: old.isStaff,
      requestedAt: old.requestedAt,
    }),
    table,
    rowId,
  );
}

export async function readSchemaVersion(
  client: Pick<Client, "execute">,
): Promise<number> {
  const version = (await client.execute("PRAGMA user_version")).rows[0]
    ?.user_version;
  if (typeof version !== "number" || version < 0 || version > SCHEMA_VERSION) {
    throw new Error(`지원하지 않는 SQLite 스키마 버전이에요: ${version}`);
  }
  return version;
}

// 백업이 끝난 뒤에만 호출해요. 행 변환과 버전 갱신은 함께 커밋해요.
export async function migrateDatabase(client: Client): Promise<void> {
  const tx = await client.transaction("write");
  try {
    if ((await readSchemaVersion(tx)) === SCHEMA_VERSION) {
      await tx.commit();
      return;
    }
    await tx.executeMultiple(SCHEMA_DDL);
    for (const table of ["queue", "history", "now_playing"] as const) {
      const rows = (await tx.execute(`SELECT * FROM ${table}`)).rows;
      for (const row of rows) {
        const id = row.id;
        if (
          (typeof id !== "string" && typeof id !== "number") ||
          typeof row.data !== "string"
        ) {
          throw new Error(`저장된 ${table} 행의 형식이 잘못됐어요`);
        }
        const song = migrateSong(row.data, table, id);
        if (table === "now_playing" && !isStoredTimestamp(row.started_at)) {
          throw new PersistedSongError(table, id, "invalid-started-at");
        }
        await tx.execute({
          sql: `UPDATE ${table} SET data = ? WHERE id = ?`,
          args: [JSON.stringify(song), id],
        });
      }
    }
    await tx.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
