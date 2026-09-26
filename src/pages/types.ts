export type SongView = {
  id: string;
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
  requestedBy: string;
  isMine: boolean;
};

export type NowPlayingView = {
  song: SongView;
  positionSec: number;
  durationSec: number | null;
};

export type Snapshot = {
  nowPlaying: NowPlayingView | null;
  queue: SongView[];
  history: SongView[];
  requestsPaused: boolean;
  notice: string;
  maxPerDevice: number;
  maxPerTable: number;
};

export type SearchHit = {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
};

export type TableRow = { id: number; label: string; url: string };
