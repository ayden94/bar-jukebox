export type Song = {
  id: string;
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
  requestedBy: string;
  deviceId: string | null;
  tableId: number | null;
  isStaff: boolean;
  requestedAt: number;
};

export type NowPlaying = {
  song: Song;
  startedAt: number;
  status: "playing" | "failed";
  positionSec: number;
  durationSec: number | null;
};

// /api/state·SSE 페이로드 모양. 도메인 서비스들이 합쳐진 전체 상태다.
export type JukeboxState = {
  nowPlaying: NowPlaying | null;
  queue: Song[];
  history: Song[];
  requestsPaused: boolean;
  notice: string;
  maxPerDevice: number;
  maxPerTable: number;
};
