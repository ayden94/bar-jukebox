// Apple v3 공개 문서와 실제 배포 SDK의 좁은 경계예요. 원시 SDK 오류는 내보내지 않아요.
export interface MusicKitItem {
  readonly id: string;
}

export interface MusicKitQueue {
  readonly items: readonly MusicKitItem[];
}

export interface MusicKitInstance {
  readonly isAuthorized: boolean;
  readonly nowPlayingItem: MusicKitItem | undefined;
  readonly playbackState: number;
  readonly currentPlaybackTime: number;
  readonly currentPlaybackDuration: number;
  readonly queue: MusicKitQueue | undefined;
  repeatMode: number;
  shuffleMode: number;
  autoplayEnabled: boolean;
  previewOnly: boolean;
  playbackMode: number;
  volume: number;
  authorize(): Promise<string | void>;
  unauthorize(): Promise<void>;
  hasMusicSubscription(): Promise<boolean>;
  setQueue(options: {
    readonly song: string;
    readonly startPlaying: false;
    readonly startTime: 0;
  }): Promise<MusicKitQueue | void>;
  play(): Promise<void> | void;
  pause(): Promise<void> | void;
  stop(): Promise<void>;
  seekToTime(position: number): Promise<void>;
  addEventListener(name: string, callback: (event: unknown) => void): void;
  removeEventListener(name: string, callback: (event: unknown) => void): void;
}

export interface MusicKitSDK {
  readonly version: string;
  readonly PlaybackStates: {
    readonly none: number;
    readonly loading: number;
    readonly playing: number;
    readonly paused: number;
    readonly stopped: number;
    readonly ended: number;
    readonly seeking: number;
    readonly waiting: number;
    readonly stalled: number;
    readonly completed: number;
  };
  readonly PlayerRepeatMode: { readonly none: number };
  readonly PlayerShuffleMode: { readonly off: number };
  readonly PlaybackMode: { readonly FULL_PLAYBACK_ONLY: number };
  configure(options: {
    readonly developerToken: string;
    readonly app: { readonly name: string; readonly build: string };
  }): Promise<unknown>;
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isMusicKit(value: unknown): value is MusicKitSDK {
  return (
    record(value) &&
    typeof value.version === "string" &&
    value.version.startsWith("3.") &&
    typeof value.configure === "function" &&
    record(value.PlaybackStates) &&
    [
      "none",
      "loading",
      "playing",
      "paused",
      "stopped",
      "ended",
      "seeking",
      "waiting",
      "stalled",
      "completed",
    ].every(
      (key) =>
        typeof value.PlaybackStates === "object" &&
        value.PlaybackStates !== null &&
        key in value.PlaybackStates &&
        typeof Reflect.get(value.PlaybackStates, key) === "number",
    ) &&
    record(value.PlayerRepeatMode) &&
    typeof value.PlayerRepeatMode.none === "number" &&
    record(value.PlayerShuffleMode) &&
    typeof value.PlayerShuffleMode.off === "number" &&
    record(value.PlaybackMode) &&
    typeof value.PlaybackMode.FULL_PLAYBACK_ONLY === "number"
  );
}

export function isInstance(value: unknown): value is MusicKitInstance {
  return (
    record(value) &&
    typeof value.isAuthorized === "boolean" &&
    typeof value.playbackState === "number" &&
    typeof value.volume === "number" &&
    typeof value.autoplayEnabled === "boolean" &&
    typeof value.playbackMode === "number" &&
    (value.queue === undefined ||
      (record(value.queue) && Array.isArray(value.queue.items))) &&
    [
      "authorize",
      "unauthorize",
      "hasMusicSubscription",
      "setQueue",
      "play",
      "pause",
      "stop",
      "seekToTime",
      "addEventListener",
      "removeEventListener",
    ].every((name) => typeof value[name] === "function")
  );
}

// SDK에는 AbortSignal이 없어요. 호출은 취소하되 늦게 끝나는 작업도 반드시 회수해요.
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function retireInstance(instance: unknown): Promise<void> {
  if (!record(instance)) return;
  // 부분 초기화도 제공된 정리 메서드만 호출해요. 결과를 정지 증거로 쓰지 않아요.
  await Promise.allSettled(
    ["stop", "unauthorize"].map(async (name) => {
      const method = instance[name];
      if (typeof method === "function")
        await Reflect.apply(method, instance, []);
    }),
  );
}
