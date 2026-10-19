import type { TrackMetadata } from "../../music/contracts";

export type Song = TrackMetadata & {
  formatVersion: 1;
  id: string;
  requestedBy: string;
  deviceId: string | null;
  tableId: number | null;
  isStaff: boolean;
  requestedAt: number;
};

export type NowPlaying = {
  song: Song;
  startedAt: number | null;
  reservedAt?: number;
  status:
    | "starting"
    | "playing"
    | "paused"
    | "waiting"
    | "reconciliation-required";
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
  // 신청곡이 없을 때 흐르는 배경 음악이에요. 곡 이름과 아티스트만 공개해요.
  background: { title: string; artist: string | null } | null;
};
