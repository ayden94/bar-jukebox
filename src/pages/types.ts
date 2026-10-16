export type TrackRef = {
  providerId: string;
  trackId: string;
};

export type TrackMetadata = {
  ref: TrackRef;
  title: string;
  artist: string;
  durationSec: number | null;
  artwork: { providerId: string; artworkId: string } | null;
  sourceUrl: string | null;
};

export type SongView = TrackMetadata & {
  formatVersion: 1;
  id: string;
  requestedBy: string;
  isMine: boolean;
};

export type NowPlayingView = {
  song: SongView;
  status:
    | "starting"
    | "playing"
    | "paused"
    | "waiting"
    | "reconciliation-required";
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

export type SearchPage = {
  hits: TrackMetadata[];
  nextCursor: string | null;
};

export type TableRow = { id: number; label: string; url: string };
