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

export type JukeboxState = {
  nowPlaying: NowPlaying | null;
  queue: Song[];
  history: Song[];
  requestsPaused: boolean;
  notice: string;
};
