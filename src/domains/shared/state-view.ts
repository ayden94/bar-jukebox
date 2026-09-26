import type { JukeboxState, NowPlaying, PublicSong, Song } from "./types";

export type QueueStateView = {
  snapshot(): {
    nowPlaying: NowPlaying | null;
    queue: Song[];
    history: Song[];
  };
};

export type SettingsStateView = {
  read(): {
    requestsPaused: boolean;
    notice: string;
    maxPerDevice: number;
    maxPerTable: number;
  };
};

export function publicSong(song: Song, viewerId: string): PublicSong {
  const { deviceId, ...visible } = song;
  return { ...visible, isMine: Boolean(viewerId) && deviceId === viewerId };
}

export function composeState(
  queue: QueueStateView,
  settings: SettingsStateView,
  viewerId: string,
): JukeboxState {
  const snapshot = queue.snapshot();
  return {
    ...settings.read(),
    nowPlaying: snapshot.nowPlaying
      ? {
          ...snapshot.nowPlaying,
          song: publicSong(snapshot.nowPlaying.song, viewerId),
        }
      : null,
    queue: snapshot.queue.map((song) => publicSong(song, viewerId)),
    history: snapshot.history.map((song) => publicSong(song, viewerId)),
  };
}
