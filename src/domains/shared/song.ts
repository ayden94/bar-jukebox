import type { TrackMetadata } from "../../music/contracts";
import type { Song } from "./types";

// 손님 신청과 직원 추가가 같은 Song 모양을 만들도록 한 곳에 모은다.
export function makeSong(
  input: TrackMetadata,
  requestedBy: string,
  deviceId: string | null,
  isStaff: boolean,
  tableId: number | null,
): Song {
  return {
    id: crypto.randomUUID(),
    formatVersion: 1,
    ref: input.ref,
    title: input.title,
    artist: input.artist,
    artwork: input.artwork,
    sourceUrl: input.sourceUrl,
    durationSec: input.durationSec,
    requestedBy,
    deviceId,
    tableId,
    isStaff,
    requestedAt: Date.now(),
  };
}
