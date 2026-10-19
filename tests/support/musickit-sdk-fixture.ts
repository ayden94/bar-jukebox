import type {
  MusicKitInstance,
  MusicKitItem,
  MusicKitQueue,
  MusicKitSDK,
} from "../../src/music/providers/apple-music/browser/sdk";

// SDK 프로토콜 시험용이에요. 실제 Apple 인증, DRM, 오디오를 구현하지 않아요.
export class MusicKitFixture implements MusicKitInstance {
  isAuthorized = false;
  nowPlayingItem: MusicKitItem | undefined;
  playbackState = 0;
  currentPlaybackTime = 0;
  currentPlaybackDuration = 180;
  queue: MusicKitQueue = { items: [] };
  repeatMode = 0;
  shuffleMode = 0;
  autoplayEnabled = false;
  previewOnly = false;
  playbackMode = 1;
  volume = 1;
  subscription = true;
  authorization: "success" | "reject" | "cancel" = "success";
  automatic = true;
  calls: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  beforeAuthorize: (() => Promise<void>) | null = null;
  beforeQueue: (() => Promise<void>) | null = null;
  onChange: () => void = () => {};

  readonly sdk: MusicKitSDK = {
    version: "3.2526.0-prerelease.x",
    PlaybackStates: {
      none: 0,
      loading: 1,
      playing: 2,
      paused: 3,
      stopped: 4,
      ended: 5,
      seeking: 6,
      waiting: 8,
      stalled: 9,
      completed: 10,
    },
    PlayerRepeatMode: { none: 0 },
    PlayerShuffleMode: { off: 0 },
    PlaybackMode: { FULL_PLAYBACK_ONLY: 2 },
    configure: async () => {
      this.calls.push("configure");
      this.onChange();
      return this;
    },
  };

  async authorize() {
    this.calls.push("authorize");
    await this.beforeAuthorize?.();
    if (this.authorization === "reject") throw new Error("SIMULATED rejection");
    if (this.authorization === "cancel") return;
    this.isAuthorized = true;
    this.onChange();
    return "SIMULATED-USER-TOKEN-NEVER-TRANSMIT";
  }
  async unauthorize() {
    this.calls.push("unauthorize");
    this.isAuthorized = false;
    this.onChange();
  }
  async hasMusicSubscription() {
    return this.subscription;
  }
  async setQueue(options: { readonly song: string }) {
    this.calls.push(`setQueue:${options.song}`);
    await this.beforeQueue?.();
    this.playbackState = 4;
    this.currentPlaybackTime = 0;
    this.queue = { items: [{ id: options.song }] };
    this.nowPlayingItem = this.queue.items[0];
    this.onChange();
    return this.queue;
  }
  async play() {
    this.calls.push("play");
    this.nowPlayingItem = this.queue.items[0];
    if (this.automatic) this.state(2);
    this.onChange();
  }
  async pause() {
    this.calls.push("pause");
    if (this.automatic) this.state(3);
    this.onChange();
  }
  async stop() {
    this.calls.push("stop");
    if (this.automatic) this.state(4);
    this.onChange();
  }
  async seekToTime(position: number) {
    this.calls.push(`seek:${position}`);
    this.currentPlaybackTime = position;
    this.emit("playbackTimeDidChange", {});
  }
  addEventListener(name: string, callback: (event: unknown) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
    this.onChange();
  }
  removeEventListener(name: string, callback: (event: unknown) => void) {
    this.listeners.get(name)?.delete(callback);
    this.onChange();
  }
  emit(name: string, event: unknown) {
    for (const callback of this.listeners.get(name) ?? []) callback(event);
    this.onChange();
  }
  state(state: number) {
    const oldState = this.playbackState;
    const nowPlayingItem = this.nowPlayingItem;
    if (state === 4 || state === 5 || state === 10) {
      this.nowPlayingItem = undefined;
      this.emit("nowPlayingItemDidChange", { item: undefined });
    }
    this.playbackState = state;
    this.emit("playbackStateDidChange", {
      oldState,
      state,
      nowPlayingItem,
    });
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }
}
