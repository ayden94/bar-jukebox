import type {
  NativeBinding,
  PlaybackContext,
  PlaybackObservation,
} from "../../../contracts/index";
import type {
  MusicKitInstance,
  MusicKitItem,
  MusicKitQueue,
  MusicKitSDK,
} from "./sdk";

export type Occurrence = {
  readonly id: string;
  readonly queue: MusicKitQueue;
  readonly item: MusicKitItem;
  readonly trackId: string;
  context: PlaybackContext;
  hasPlayed: boolean;
  ended: boolean;
  stopped: boolean;
};

export function ownsQueue(music: MusicKitInstance, owned: Occurrence): boolean {
  return (
    music.queue === owned.queue &&
    music.queue?.items.length === 1 &&
    music.queue.items[0] === owned.item &&
    owned.item.id === owned.trackId
  );
}

export function ownsItem(music: MusicKitInstance, owned: Occurrence): boolean {
  return ownsQueue(music, owned) && music.nowPlayingItem === owned.item;
}

export function binding(owned: Occurrence): NativeBinding {
  return {
    providerId: "apple-music",
    modeId: "musickit",
    version: 1,
    payload: {
      occurrenceId: owned.id,
      trackId: owned.trackId,
      connectionGeneration: owned.context.connectionGeneration,
      executorSessionId: owned.context.executorSessionId,
      attemptId: owned.context.attemptId,
    },
  };
}

export function playbackState(
  music: MusicKitInstance,
  sdk: MusicKitSDK,
): Exclude<PlaybackObservation["state"], "ended"> {
  const states = sdk.PlaybackStates;
  switch (music.playbackState) {
    case states.playing:
      return "playing";
    case states.paused:
      return "paused";
    case states.stopped:
      return "stopped";
    case states.loading:
    case states.seeking:
    case states.waiting:
    case states.stalled:
      return "buffering";
    // 종료는 snapshot이 아니라 현재 occurrence의 종료 이벤트로만 확정해요.
    default:
      return "unknown";
  }
}
