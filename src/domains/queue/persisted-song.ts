import type { Song } from "../shared/types";

type SongTable = "queue" | "history" | "now_playing";
type PersistedSongErrorCode =
  | "invalid-json"
  | "invalid-song"
  | "invalid-started-at";

export class PersistedSongError extends Error {
  constructor(
    public readonly table: SongTable,
    public readonly rowId: string | number,
    public readonly code: PersistedSongErrorCode,
  ) {
    // JSON 원문과 파서 예외에는 기기 식별자 등이 들어갈 수 있어요.
    super(
      `저장된 곡을 복원할 수 없어요: ${table} 행 ${JSON.stringify(rowId)} (${code})`,
    );
    this.name = "PersistedSongError";
  }
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isStoredTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSong(value: unknown): value is Song {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const song = value as Record<string, unknown>;
  return (
    nonemptyString(song.id) &&
    song.formatVersion === 1 &&
    isReference(song.ref, "trackId") &&
    nonemptyString(song.title) &&
    nonemptyString(song.artist) &&
    (song.artwork === null || isReference(song.artwork, "artworkId")) &&
    (song.sourceUrl === null || nonemptyString(song.sourceUrl)) &&
    (song.durationSec === null ||
      (typeof song.durationSec === "number" &&
        Number.isFinite(song.durationSec) &&
        song.durationSec >= 0)) &&
    nonemptyString(song.requestedBy) &&
    (song.deviceId === null || nonemptyString(song.deviceId)) &&
    (song.tableId === null || positiveSafeInteger(song.tableId)) &&
    typeof song.isStaff === "boolean" &&
    isStoredTimestamp(song.requestedAt)
  );
}

function isReference(value: unknown, key: "trackId" | "artworkId"): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return nonemptyString(ref.providerId) && nonemptyString(ref[key]);
}

export function decodePersistedSong(
  json: string,
  table: SongTable,
  rowId: string | number,
): Song {
  let song: unknown;
  try {
    song = JSON.parse(json);
  } catch {
    throw new PersistedSongError(table, rowId, "invalid-json");
  }
  if (!isSong(song) || (table !== "now_playing" && song.id !== rowId)) {
    throw new PersistedSongError(table, rowId, "invalid-song");
  }
  // 저장 JSON에 남은 예전 native 자료나 추가 필드를 공개 모델에 섞지 않아요.
  return {
    formatVersion: 1,
    id: song.id,
    ref: { providerId: song.ref.providerId, trackId: song.ref.trackId },
    title: song.title,
    artist: song.artist,
    durationSec: song.durationSec,
    artwork: song.artwork
      ? {
          providerId: song.artwork.providerId,
          artworkId: song.artwork.artworkId,
        }
      : null,
    sourceUrl: song.sourceUrl,
    requestedBy: song.requestedBy,
    deviceId: song.deviceId,
    tableId: song.tableId,
    isStaff: song.isStaff,
    requestedAt: song.requestedAt,
  };
}
