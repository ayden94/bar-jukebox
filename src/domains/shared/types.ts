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

export type PublicSong = Omit<Song, "deviceId"> & { isMine: boolean };

// 인증 식별자 대신 요청한 기기의 소유 여부만 공개한다.
export type JukeboxState = {
  nowPlaying: (Omit<NowPlaying, "song"> & { song: PublicSong }) | null;
  queue: PublicSong[];
  history: PublicSong[];
  requestsPaused: boolean;
  notice: string;
  maxPerDevice: number;
  maxPerTable: number;
};
