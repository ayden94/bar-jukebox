import type {
  CommandOutcome,
  ConnectedTarget,
  MusicResult,
  NativeBinding,
  PlaybackCommand,
  PlaybackContext,
  PlaybackObservation,
  PlaybackPort,
  Reconciliation,
} from "../../../contracts/index";
import { Observations } from "./observations";
import {
  binding,
  type Occurrence,
  ownsItem,
  ownsQueue,
  playbackState,
} from "./occurrence";
import {
  abortable,
  type MusicKitInstance,
  type MusicKitItem,
  type MusicKitSDK,
  record,
} from "./sdk";

// allow: SIZE_OK — 명령 발행, SDK 이벤트, 취소가 같은 occurrence/fence를 갱신하는 단일 상태 머신이에요.
export class MusicKitPlayback implements PlaybackPort {
  private connected: ConnectedTarget | null = null;
  private owned: Occurrence | null = null;
  private context: PlaybackContext | null = null;
  private sequence = 0;
  private disposed = false;
  private busy = false;
  private pendingState: unknown = null;
  private executorSessionId: string | null = null;
  private readonly commands = new Set<string>();
  private readonly usedItems = new WeakSet<MusicKitItem>();
  private uncertain = false;
  private operation: Promise<void> = Promise.resolve();
  private readonly lifetime = new AbortController();
  private readonly observations = new Observations();
  private readonly listeners: readonly [string, (event: unknown) => void][];

  constructor(
    private readonly music: MusicKitInstance,
    private readonly sdk: MusicKitSDK,
  ) {
    this.listeners = [
      ["playbackStateDidChange", (event) => this.onState(event)],
      ["playbackTimeDidChange", () => this.sample()],
      ["nowPlayingItemDidChange", () => this.sample()],
      ["queueItemsDidChange", () => this.sample()],
      ["mediaPlaybackError", () => this.invalidate("unknown")],
      [
        "drmUnsupported",
        () => {
          this.invalidate("unavailable");
          // 미리 듣기 fallback을 제품의 전체 곡 재생으로 보고하지 않아요.
          void this.music.stop().catch(() => this.invalidate("unknown"));
        },
      ],
      [
        "authorizationStatusDidChange",
        () => {
          if (!this.music.isAuthorized) this.invalidate("unavailable");
        },
      ],
    ];
    let attempted = 0;
    try {
      for (const [name, listener] of this.listeners) {
        attempted++;
        music.addEventListener(name, listener);
      }
    } catch (error) {
      for (const [name, listener] of this.listeners.slice(0, attempted))
        music.removeEventListener(name, listener);
      throw error;
    }
  }

  connect(connection: ConnectedTarget) {
    this.connected = connection;
    this.uncertain = false;
    this.owned = null;
    this.context = null;
    this.executorSessionId = null;
    this.commands.clear();
  }

  disconnect() {
    this.connected = null;
    this.invalidate("unavailable");
  }

  private snapshot(state: PlaybackObservation["state"]): PlaybackObservation {
    const owned = this.owned;
    const context = this.context;
    const finite = (value: number) =>
      Number.isFinite(value) && value >= 0 ? value : null;
    const base = {
      trackRef: owned
        ? { providerId: "apple-music", trackId: owned.trackId }
        : null,
      target: this.connected?.target ?? null,
      connectionGeneration: this.connected?.connectionGeneration ?? null,
      correlation: context
        ? {
            commandId: context.commandId,
            attemptId: context.attemptId,
            executorSessionId: context.executorSessionId,
          }
        : null,
      binding: owned ? binding(owned) : null,
      sequence: ++this.sequence,
      positionSec: owned ? finite(this.music.currentPlaybackTime) : null,
      durationSec: owned ? finite(this.music.currentPlaybackDuration) : null,
    };
    return state === "ended"
      ? { ...base, state, endReason: "natural-end" }
      : { ...base, state };
  }

  private currentState(): PlaybackObservation["state"] {
    if (this.disposed || !this.connected || !this.music.isAuthorized)
      return "unavailable";
    if (this.uncertain) return "unknown";
    if (this.owned && !ownsQueue(this.music, this.owned)) return "unknown";
    if (
      this.owned &&
      ownsQueue(this.music, this.owned) &&
      (!this.music.nowPlayingItem ||
        this.music.nowPlayingItem === this.owned.item)
    ) {
      if (
        (this.owned.stopped || this.owned.ended) &&
        this.music.playbackState === this.sdk.PlaybackStates.stopped
      )
        return "stopped";
      if (
        this.owned.ended &&
        (this.music.playbackState === this.sdk.PlaybackStates.ended ||
          this.music.playbackState === this.sdk.PlaybackStates.completed)
      )
        return "ended";
    }
    if (this.owned && !ownsItem(this.music, this.owned)) return "interrupted";
    return playbackState(this.music, this.sdk);
  }

  private invalidate(state: "unknown" | "unavailable") {
    this.uncertain = true;
    if (!this.disposed) this.observations.publish(this.snapshot(state));
  }

  private sample() {
    if (this.disposed || this.busy) return;
    if (this.owned && !ownsQueue(this.music, this.owned)) {
      this.invalidate("unknown");
      return;
    }
    // SDK는 terminal 상태 이벤트 직전에 nowPlayingItem을 비워요.
    // 이 과도 상태를 곡 교체나 침묵으로 확정하지 않고 item을 담은 이벤트를 기다려요.
    if (
      this.owned &&
      ownsQueue(this.music, this.owned) &&
      !this.music.nowPlayingItem &&
      !this.owned.stopped &&
      !this.owned.ended
    )
      return;
    const state = this.currentState();
    if (
      (this.owned?.ended || this.owned?.stopped) &&
      this.music.playbackState === this.sdk.PlaybackStates.playing
    ) {
      this.invalidate("unknown");
      return;
    }
    if (state === "interrupted") this.uncertain = true;
    this.observations.publish(this.snapshot(state));
  }

  private onState(event: unknown) {
    if (this.disposed || this.uncertain || !record(event)) return;
    const owned = this.owned;
    if (this.busy) {
      if (owned && event.nowPlayingItem === owned.item)
        this.pendingState = event;
      return;
    }
    if (!owned) {
      // idle release도 실제 SDK stopped 상태를 관측해야 해요.
      if (event.state === this.music.playbackState) this.sample();
      return;
    }
    if (event.nowPlayingItem !== owned.item || !ownsQueue(this.music, owned))
      return;
    const terminal =
      event.state === this.sdk.PlaybackStates.stopped ||
      event.state === this.sdk.PlaybackStates.ended ||
      event.state === this.sdk.PlaybackStates.completed;
    if (
      !ownsItem(this.music, owned) &&
      !(terminal && !this.music.nowPlayingItem)
    )
      return;
    if (event.state !== this.music.playbackState) return;
    if (
      (owned.ended || owned.stopped) &&
      event.state === this.sdk.PlaybackStates.playing
    ) {
      this.invalidate("unknown");
      return;
    }
    if (event.state === this.sdk.PlaybackStates.playing) owned.hasPlayed = true;
    if (event.state === this.sdk.PlaybackStates.stopped) {
      owned.stopped = true;
      owned.ended = false;
    }
    if (
      event.state === this.sdk.PlaybackStates.ended ||
      event.state === this.sdk.PlaybackStates.completed
    ) {
      if (
        !owned.hasPlayed ||
        owned.ended ||
        this.music.repeatMode !== this.sdk.PlayerRepeatMode.none ||
        this.music.autoplayEnabled ||
        this.music.shuffleMode !== this.sdk.PlayerShuffleMode.off
      )
        return;
      owned.ended = true;
      this.observations.publish(this.snapshot("ended"));
    } else this.sample();
  }

  observe(signal: AbortSignal) {
    return this.observations.observe(
      this.snapshot(this.currentState()),
      signal,
    );
  }

  async reconcile(
    native: NativeBinding,
    signal: AbortSignal,
  ): Promise<MusicResult<Reconciliation>> {
    signal.throwIfAborted();
    const owned = this.owned;
    if (this.disposed) return { ok: false, error: { code: "disconnected" } };
    if (
      !owned ||
      !record(native.payload) ||
      native.providerId !== "apple-music" ||
      native.modeId !== "musickit" ||
      native.version !== 1 ||
      this.busy ||
      this.uncertain ||
      !this.connected ||
      !ownsQueue(this.music, owned)
    )
      return { ok: true, value: { status: "unknown" } };
    const expected = binding(owned).payload;
    if (
      !record(expected) ||
      Object.keys(expected).some(
        (key) =>
          !record(native.payload) || native.payload[key] !== expected[key],
      )
    ) {
      return { ok: true, value: { status: "unknown" } };
    }
    const matches =
      ownsItem(this.music, owned) ||
      (ownsQueue(this.music, owned) &&
        (this.currentState() === "stopped" || this.currentState() === "ended"));
    return {
      ok: true,
      value: {
        status: matches ? "match" : "mismatch",
        observation: this.snapshot(
          matches ? this.currentState() : "interrupted",
        ),
      },
    };
  }

  async execute(
    command: PlaybackCommand,
    signal: AbortSignal,
  ): Promise<CommandOutcome> {
    signal.throwIfAborted();
    const context = command.context;
    const reject = (
      code: "disconnected" | "invalid-track" | "auth-required" | "unsupported",
    ): CommandOutcome => ({ status: "rejected", context, error: { code } });
    const connected = this.connected;
    if (
      this.disposed ||
      !connected ||
      this.busy ||
      this.uncertain ||
      context.connectionGeneration !== connected.connectionGeneration ||
      context.target.providerId !== connected.target.providerId ||
      context.target.modeId !== connected.target.modeId ||
      context.target.targetId !== connected.target.targetId
    )
      return reject("disconnected");
    if (!this.music.isAuthorized) return reject("auth-required");
    if (
      (this.executorSessionId &&
        context.executorSessionId !== this.executorSessionId) ||
      this.commands.has(context.commandId)
    )
      return reject("disconnected");
    if (
      command.type === "play" &&
      (command.trackRef.providerId !== "apple-music" ||
        !/^[1-9]\d*$/.test(command.trackRef.trackId))
    )
      return reject("invalid-track");
    if (
      command.type === "seek" &&
      (!Number.isFinite(command.positionSec) || command.positionSec < 0)
    )
      return reject("unsupported");
    if (
      command.type !== "play" &&
      command.type !== "stop" &&
      (!this.owned || !ownsItem(this.music, this.owned))
    )
      return reject("invalid-track");
    if (
      this.owned?.ended &&
      command.type !== "play" &&
      command.type !== "restart" &&
      command.type !== "stop"
    )
      return reject("invalid-track");
    if (
      this.owned &&
      command.type !== "play" &&
      (context.executorSessionId !== this.owned.context.executorSessionId ||
        (command.type !== "restart" &&
          context.attemptId !== this.owned.context.attemptId))
    )
      return reject("disconnected");
    this.context = context;
    this.executorSessionId = context.executorSessionId;
    this.commands.add(context.commandId);
    if (this.owned) this.owned.context = context;
    this.busy = true;
    this.pendingState = null;
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    this.operation = this.apply(command, combined);
    try {
      await abortable(this.operation, combined);
      combined.throwIfAborted();
      this.busy = false;
      const sequence = this.sequence;
      const pending = this.pendingState;
      this.pendingState = null;
      if (pending) this.onState(pending);
      const expected =
        command.type === "play" || command.type === "restart"
          ? command.initialState
          : command.type === "resume"
            ? "playing"
            : command.type === "pause"
              ? "paused"
              : command.type === "stop"
                ? "stopped"
                : null;
      if (
        this.sequence === sequence &&
        (expected === null || this.currentState() === expected)
      )
        this.sample();
      return { status: "accepted", context };
    } catch {
      // SDK 호출 뒤 실패/취소는 재생 여부를 단정하거나 자동 재전송하지 않아요.
      this.invalidate("unknown");
      return { status: "unknown", context, error: { code: "unknown-outcome" } };
    } finally {
      this.busy = false;
    }
  }

  private async apply(command: PlaybackCommand, signal: AbortSignal) {
    switch (command.type) {
      case "play":
      case "restart": {
        const trackId =
          command.type === "play"
            ? command.trackRef.trackId
            : this.owned?.trackId;
        if (!trackId) throw new Error("현재 곡을 확인하지 못했어요.");
        this.owned = null;
        this.music.repeatMode = this.sdk.PlayerRepeatMode.none;
        this.music.shuffleMode = this.sdk.PlayerShuffleMode.off;
        this.music.autoplayEnabled = false;
        const queue = await this.music.setQueue({
          song: trackId,
          startPlaying: false,
          startTime: 0,
        });
        signal.throwIfAborted();
        const item = queue?.items[0];
        if (
          !item ||
          queue !== this.music.queue ||
          queue.items.length !== 1 ||
          item.id !== trackId ||
          this.usedItems.has(item)
        )
          throw new Error("정확한 새 재생 occurrence를 확인하지 못했어요.");
        // 상태 이벤트에는 queue/attempt가 없으므로 과거 item을 새 명령에 붙일 수 없어요.
        this.usedItems.add(item);
        this.owned = {
          id: crypto.randomUUID(),
          queue,
          item,
          trackId,
          context: command.context,
          hasPlayed: false,
          ended: false,
          stopped: false,
        };
        const volume = this.music.volume;
        if (command.initialState === "paused") this.music.volume = 0;
        await this.music.play();
        signal.throwIfAborted();
        if (command.initialState === "paused") {
          await this.music.pause();
          signal.throwIfAborted();
          if (this.music.playbackState !== this.sdk.PlaybackStates.paused)
            throw new Error("일시 정지를 확인하지 못했어요.");
          this.music.volume = volume;
        }
        if (!ownsItem(this.music, this.owned))
          throw new Error("SDK의 현재 곡이 달라요.");
        this.owned.hasPlayed =
          this.music.playbackState === this.sdk.PlaybackStates.playing;
        return;
      }
      case "pause":
        await this.music.pause();
        return;
      case "resume":
        await this.music.play();
        return;
      case "stop":
        await this.music.stop();
        return;
      case "seek":
        await this.music.seekToTime(command.positionSec);
        return;
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    for (const [name, listener] of this.listeners)
      this.music.removeEventListener(name, listener);
    this.observations.close();
    // 네트워크가 늦게 끝나도 재생을 이어가지 않도록 apply의 단계마다 abort를 확인해요.
    await this.operation.catch(() => undefined);
  }
}
