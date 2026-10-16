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
  return {
    formatVersion: song.formatVersion,
    id: song.id,
    ref: { providerId: song.ref.providerId, trackId: song.ref.trackId },
    title: song.title,
    artist: song.artist,
    durationSec: song.durationSec,
    artwork: song.artwork
      ? {
          providerId: song.artwork.providerId,
          artworkId: song.artwork.artworkId,
        }
      : null,
    sourceUrl: song.sourceUrl,
    requestedBy: song.requestedBy,
    tableId: song.tableId,
    isStaff: song.isStaff,
    requestedAt: song.requestedAt,
    isMine: Boolean(viewerId) && song.deviceId === viewerId,
  };
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
          startedAt: snapshot.nowPlaying.startedAt,
          ...(snapshot.nowPlaying.reservedAt === undefined
            ? {}
            : {
                reservedAt: snapshot.nowPlaying.reservedAt,
              }),
          status: snapshot.nowPlaying.status,
          positionSec: snapshot.nowPlaying.positionSec,
          durationSec: snapshot.nowPlaying.durationSec,
          song: publicSong(snapshot.nowPlaying.song, viewerId),
        }
      : null,
    queue: snapshot.queue.map((song) => publicSong(song, viewerId)),
    history: snapshot.history.map((song) => publicSong(song, viewerId)),
  };
}
