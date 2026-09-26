import type { JukeboxState, NowPlaying, Song } from "./types";

export type QueueStateView = {
  snapshot(): {
    nowPlaying: NowPlaying | null;
    queue: Song[];
    history: Song[];
  };
};

export type SettingsStateView = {
  read(): { requestsPaused: boolean; notice: string };
};

// /api/state·SSE 페이로드는 기존 JukeboxState 모양을 그대로 유지한다 (프론트엔드 무변경).
export function composeState(
  queue: QueueStateView,
  settings: SettingsStateView,
): JukeboxState {
  return { ...queue.snapshot(), ...settings.read() };
}
