import type { Song } from "./types";

type SongInput = {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
};

// 손님 신청과 직원 추가가 같은 Song 모양을 만들도록 한 곳에 모은다.
export function makeSong(
  input: SongInput,
  requestedBy: string,
  deviceId: string | null,
  isStaff: boolean,
): Song {
  return {
    id: crypto.randomUUID(),
    trackId: input.trackId,
    trackName: input.trackName,
    artistName: input.artistName,
    artworkUrl: input.artworkUrl,
    albumUrl: input.albumUrl,
    trackNumber: input.trackNumber,
    durationSec: input.durationSec ?? null,
    requestedBy,
    deviceId,
    isStaff,
    requestedAt: Date.now(),
  };
}
