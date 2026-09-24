export type Song = {
  id: string;
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  requestedBy: string;
  patronKey: string | null;
  requestedAt: number;
  isStaff: boolean;
};

export type NowPlaying = {
  song: Song;
  startedAt: number;
  status: "playing" | "failed";
};

export type JukeboxState = {
  nowPlaying: NowPlaying | null;
  queue: Song[];
  history: Song[];
};
