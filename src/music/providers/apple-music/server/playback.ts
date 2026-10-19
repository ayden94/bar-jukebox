import type {
  BackgroundObservation,
  BackgroundPort,
  ConnectedTarget,
  ConnectionPort,
  MusicErrorCode,
  NativeBinding,
  PlaybackCommand,
  PlaybackContext,
  PlaybackObservation,
  PlaybackPort,
  PlaybackTarget,
} from "../../../contracts/index";
import { appleMusicDescriptor } from "../index";
import type { createAppleCatalog } from "./catalog";
import {
  backgroundScript,
  controlScript,
  fadeOutScript,
  type NativeSnapshot,
  parseSnapshot,
  playlistsScript,
  prepareScript,
  restoreVolumeScript,
  type ScriptRunner,
  sameText,
  snapshotScript,
  startPlaylistScript,
  volumeScript,
} from "./native";

export type PollScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

const localTarget: PlaybackTarget = {
  providerId: "apple-music",
  modeId: "applescript",
  targetId: "local-music-app",
};

type Ownership = {
  trackId: string;
  native: NativeSnapshot;
  context: PlaybackContext;
};

function sameTarget(target: PlaybackTarget): boolean {
  return (
    target.providerId === localTarget.providerId &&
    target.modeId === localTarget.modeId &&
    target.targetId === localTarget.targetId
  );
}

function sameNative(a: NativeSnapshot, b: NativeSnapshot): boolean {
  return (
    a.id === b.id &&
    a.persistentId === b.persistentId &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.trackNumber === b.trackNumber &&
    a.discNumber === b.discNumber
  );
}

function toBinding(owned: Ownership): NativeBinding {
  return {
    providerId: "apple-music",
    modeId: "applescript",
    version: 1,
    payload: {
      trackId: owned.trackId,
      nativeId: owned.native.id,
      persistentId: owned.native.persistentId,
      title: owned.native.title,
      artist: owned.native.artist,
      album: owned.native.album,
      trackNumber: owned.native.trackNumber,
      discNumber: owned.native.discNumber,
      commandId: owned.context.commandId,
      attemptId: owned.context.attemptId,
      executorSessionId: owned.context.executorSessionId,
    },
  };
}

function fromBinding(
  binding: NativeBinding,
  target: ConnectedTarget,
): Ownership | null {
  const payload = binding.payload;
  if (
    binding.providerId !== "apple-music" ||
    binding.modeId !== "applescript" ||
    binding.version !== 1 ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("trackId" in payload) ||
    typeof payload.trackId !== "string" ||
    !/^[1-9]\d*$/.test(payload.trackId)
  ) {
    return null;
  }
  const fields = payload as Record<string, unknown>;
  const {
    nativeId,
    persistentId,
    title,
    artist,
    album,
    trackNumber,
    discNumber,
    commandId,
    attemptId,
    executorSessionId,
  } = fields;
  if (
    typeof nativeId !== "string" ||
    !nativeId ||
    typeof persistentId !== "string" ||
    !persistentId ||
    typeof title !== "string" ||
    !title ||
    typeof artist !== "string" ||
    !artist ||
    typeof album !== "string" ||
    !album ||
    typeof trackNumber !== "number" ||
    !Number.isSafeInteger(trackNumber) ||
    trackNumber < 1 ||
    typeof discNumber !== "number" ||
    !Number.isSafeInteger(discNumber) ||
    discNumber < 1 ||
    typeof commandId !== "string" ||
    !commandId ||
    typeof attemptId !== "string" ||
    !attemptId ||
    typeof executorSessionId !== "string" ||
    !executorSessionId
  ) {
    return null;
  }
  return {
    trackId: payload.trackId,
    context: {
      commandId,
      attemptId,
      executorSessionId,
      target: target.target,
      connectionGeneration: target.connectionGeneration,
    },
    native: {
      id: nativeId,
      persistentId,
      title,
      artist,
      album,
      trackNumber,
      discNumber,
      state: "stopped",
      positionSec: null,
      durationSec: null,
    },
  };
}

export function createApplePlayback(options: {
  runScript: ScriptRunner;
  resolve: ReturnType<typeof createAppleCatalog>["resolve"];
  unavailable: "configuration" | "unsupported" | null;
  pollIntervalMs: number;
  schedulePoll: PollScheduler;
}) {
  let connected: ConnectedTarget | null = null;
  let owned: Ownership | null = null;
  let previous: NativeSnapshot | null = null;
  let terminal: PlaybackObservation | null = null;
  let advancedNative: NativeSnapshot | null = null;
  let stopTarget: NativeSnapshot | null = null;
  // 다른 곡으로 바뀐 뒤 정지 명령을 받은 상태예요. 그 곡은 멈추지 않아요.
  let replaced = false;
  let isDisposed = false;
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let cancelPoll: (() => void) | null = null;
  let pollController: AbortController | null = null;
  const lifetime = new AbortController();
  const streams = new Set<ReturnType<typeof stream>>();

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  }

  function observation(
    native: NativeSnapshot | null,
    state: Exclude<PlaybackObservation["state"], "ended">,
    owner = owned,
  ): PlaybackObservation {
    return {
      state,
      trackRef: owner
        ? { providerId: "apple-music", trackId: owner.trackId }
        : null,
      target: connected?.target ?? null,
      connectionGeneration: connected?.connectionGeneration ?? null,
      correlation: owner
        ? {
            commandId: owner.context.commandId,
            attemptId: owner.context.attemptId,
            executorSessionId: owner.context.executorSessionId,
          }
        : null,
      binding: owner ? toBinding(owner) : null,
      sequence: ++sequence,
      positionSec: native?.positionSec ?? null,
      durationSec: native?.durationSec ?? null,
    };
  }

  function publish(snapshot: PlaybackObservation) {
    for (const subscriber of streams) {
      subscriber.push(snapshot);
    }
  }

  function stream(signal: AbortSignal) {
    let isClosed = false;
    const buffered: PlaybackObservation[] = [];
    const waiting: Array<
      (result: IteratorResult<PlaybackObservation, undefined>) => void
    > = [];
    const subscription = {
      push(snapshot: PlaybackObservation) {
        if (isClosed) {
          return;
        }
        const resolve = waiting.shift();
        if (resolve) {
          resolve({ done: false, value: snapshot });
        } else {
          // 느린 소비자는 최신 snapshot만 필요해요.
          buffered.splice(0, buffered.length, snapshot);
        }
      },
      close() {
        if (isClosed) {
          return;
        }
        isClosed = true;
        signal.removeEventListener("abort", subscription.close);
        buffered.length = 0;
        for (const resolve of waiting.splice(0)) {
          resolve({ done: true, value: undefined });
        }
        streams.delete(subscription);
        if (streams.size === 0) {
          cancelPoll?.();
          cancelPoll = null;
          pollController?.abort();
        }
      },
      iterator: {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<PlaybackObservation, undefined>> {
          if (isClosed) {
            return Promise.resolve({ done: true, value: undefined });
          }
          const snapshot = buffered.shift();
          return snapshot
            ? Promise.resolve({ done: false, value: snapshot })
            : new Promise((resolve) => waiting.push(resolve));
        },
        async return(): Promise<
          IteratorResult<PlaybackObservation, undefined>
        > {
          subscription.close();
          return { done: true, value: undefined };
        },
      } satisfies AsyncIterableIterator<PlaybackObservation, undefined>,
    };
    signal.addEventListener("abort", subscription.close, { once: true });
    streams.add(subscription);
    if (signal.aborted || isDisposed) {
      subscription.close();
    }
    return subscription;
  }

  async function sample(signal: AbortSignal): Promise<PlaybackObservation> {
    if (isDisposed || !connected) {
      return observation(null, "unavailable", null);
    }
    if (terminal) {
      return { ...terminal, sequence: ++sequence };
    }
    if (replaced && owned) {
      return observation(null, "stopped");
    }
    let native: NativeSnapshot | null;
    try {
      native = parseSnapshot(await options.runScript(snapshotScript, signal));
      if (isDisposed || signal.aborted) {
        return observation(null, "unavailable", null);
      }
    } catch {
      previous = null;
      return observation(null, "unavailable");
    }
    if (!native || !owned) {
      previous = null;
      return {
        ...observation(native, "unknown"),
        trackRef: null,
        binding: null,
      };
    }
    if (
      stopTarget &&
      sameNative(native, stopTarget) &&
      native.state === "stopped"
    ) {
      return observation(native, "stopped");
    }
    if (sameNative(native, owned.native)) {
      const atEnd =
        native.state === "stopped" &&
        previous?.state === "playing" &&
        sameNative(previous, native) &&
        native.durationSec !== null &&
        native.durationSec > 0 &&
        ((native.positionSec !== null &&
          native.positionSec >= native.durationSec - 0.15) ||
          (previous.positionSec !== null &&
            previous.positionSec >= native.durationSec - 0.3));
      previous = native;
      if (atEnd) {
        terminal = {
          ...observation(native, "unknown"),
          state: "ended",
          endReason: "natural-end",
        };
        return terminal;
      }
      return observation(native, native.state);
    }
    const advanced =
      previous?.state === "playing" &&
      sameNative(previous, owned.native) &&
      previous.durationSec !== null &&
      previous.durationSec > 0 &&
      previous.positionSec !== null &&
      previous.positionSec >= previous.durationSec - 1 &&
      native.state === "playing" &&
      native.album === owned.native.album &&
      native.artist === owned.native.artist &&
      native.discNumber === owned.native.discNumber &&
      native.trackNumber === owned.native.trackNumber + 1 &&
      native.positionSec !== null &&
      native.positionSec <= 2;
    if (advanced) {
      try {
        // 재조회 사이 사용자가 바꾼 음악을 정지하지 않도록 native에서도 ID를 대조해요.
        const result = await options.runScript(
          controlScript(
            native,
            'if player state is not playing or player position > 2 then return "mismatch"\n  stop',
          ),
          signal,
        );
        if (result === "applied") {
          advancedNative = native;
          terminal = {
            ...observation(previous, "unknown"),
            state: "ended",
            endReason: "owned-advance",
          };
          return terminal;
        }
      } catch {
        // 정지 결과를 모르면 완료 관측을 만들지 않아요.
      }
    }
    // 방금 소유 곡을 확인한 뒤 다른 곡이 실제로 재생 중이면(자동 추천, 직원 조작)
    // 신청곡은 끝난 것이에요. 흐르는 음악은 멈추지 않고 다음 신청으로 넘어가요.
    if (
      native.state === "playing" &&
      previous !== null &&
      sameNative(previous, owned.native)
    ) {
      terminal = {
        ...observation(previous, "unknown"),
        state: "ended",
        endReason: "replaced",
      };
      return terminal;
    }
    const lost = {
      ...observation(native, "unknown"),
      trackRef: null,
      binding: null,
    };
    owned = null;
    previous = null;
    return lost;
  }

  function poll() {
    cancelPoll = null;
    if (streams.size === 0 || isDisposed) {
      return;
    }
    void serialize(async () => {
      if (streams.size === 0 || isDisposed) {
        return;
      }
      const controller = new AbortController();
      pollController = controller;
      publish(
        await sample(AbortSignal.any([lifetime.signal, controller.signal])),
      );
      if (pollController === controller) {
        pollController = null;
      }
      if (streams.size > 0 && !isDisposed && !cancelPoll) {
        cancelPoll = options.schedulePoll(poll, options.pollIntervalMs);
      }
    });
  }

  const connection: ConnectionPort = {
    async listTargets(signal) {
      signal.throwIfAborted();
      if (isDisposed) {
        return { ok: false, error: { code: "disconnected" } };
      }
      return {
        ok: true,
        value: options.unavailable
          ? []
          : [
              {
                ref: localTarget,
                label: "이 Mac의 Music 앱",
                location: "server",
              },
            ],
      };
    },
    connect(target, signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        if (isDisposed || options.unavailable || !sameTarget(target)) {
          return {
            ok: false,
            error: {
              code: isDisposed
                ? "disconnected"
                : (options.unavailable ?? "configuration"),
            },
          };
        }
        try {
          const state = await options.runScript(
            '-- jukebox:connect\ntell application "Music" to player state as text',
            AbortSignal.any([signal, lifetime.signal]),
          );
          if (!["playing", "paused", "stopped"].includes(state.trim())) {
            return { ok: false, error: { code: "disconnected" } };
          }
        } catch (error) {
          signal.throwIfAborted();
          return {
            ok: false,
            error: {
              code:
                error instanceof Error && error.message === "permission-denied"
                  ? "permission-denied"
                  : "disconnected",
            },
          };
        }
        if (isDisposed) {
          return { ok: false, error: { code: "disconnected" } };
        }
        connected = {
          target: localTarget,
          connectionGeneration: crypto.randomUUID(),
          location: "server",
          capabilities: appleMusicDescriptor.modes[0].capabilities,
        };
        owned = null;
        previous = null;
        terminal = null;
        stopTarget = null;
        advancedNative = null;
        replaced = false;
        return { ok: true, value: connected };
      });
    },
    async disconnect(signal) {
      signal.throwIfAborted();
      // 연결 해제는 외부 오디오 정지를 증명하지 않아요.
      return serialize(async () => {
        signal.throwIfAborted();
        connected = null;
        owned = null;
        previous = null;
        terminal = null;
        replaced = false;
        publish(observation(null, "unavailable", null));
        return { ok: true, value: undefined };
      });
    },
  };

  const playback: PlaybackPort = {
    execute(command, signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        const reject = (code: Exclude<MusicErrorCode, "unknown-outcome">) => ({
          status: "rejected" as const,
          context: command.context,
          error: { code },
        });
        if (isDisposed || !connected) {
          return reject(options.unavailable ?? "disconnected");
        }
        if (
          !sameTarget(command.context.target) ||
          command.context.connectionGeneration !==
            connected.connectionGeneration
        ) {
          return reject("disconnected");
        }
        const combined = AbortSignal.any([signal, lifetime.signal]);
        if (command.type === "play") {
          const track = await options.resolve(command.trackRef, combined);
          if (!track.ok) {
            return track.error.code === "unknown-outcome"
              ? {
                  status: "unknown",
                  context: command.context,
                  error: { code: "unknown-outcome" },
                }
              : reject(track.error.code);
          }
          signal.throwIfAborted();
          if (isDisposed) {
            return reject("disconnected");
          }
          let volume: number | null = null;
          try {
            owned = null;
            previous = null;
            terminal = null;
            stopTarget = null;
            advancedNative = null;
            replaced = false;
            const current = Number(
              await options.runScript(volumeScript, combined),
            );
            volume = Number.isFinite(current) && current > 0 ? current : null;
            const native = parseSnapshot(
              await options.runScript(
                prepareScript(track.value, command.initialState),
                combined,
              ),
            );
            if (
              !native ||
              !sameText(native.title, track.value.metadata.title) ||
              !sameText(native.artist, track.value.metadata.artist) ||
              (track.value.album !== "" &&
                !sameText(native.album, track.value.album)) ||
              native.trackNumber !== track.value.trackNumber ||
              native.discNumber !== track.value.discNumber ||
              combined.aborted
            ) {
              return {
                status: "unknown",
                context: command.context,
                error: { code: "unknown-outcome" },
              };
            }
            owned = {
              trackId: command.trackRef.trackId,
              native,
              context: command.context,
            };
          } catch {
            if (volume !== null) {
              // 준비가 중간에 끊겨도 음소거로 남지 않게 해요.
              await options
                .runScript(restoreVolumeScript(volume), lifetime.signal)
                .catch(() => undefined);
            }
            return {
              status: "unknown",
              context: command.context,
              error: { code: "unknown-outcome" },
            };
          }
        } else {
          if (
            !owned ||
            (command.type !== "restart" &&
              owned.context.attemptId !== command.context.attemptId) ||
            owned.context.executorSessionId !==
              command.context.executorSessionId
          ) {
            return reject("disconnected");
          }
          if (
            terminal?.state === "ended" &&
            terminal.endReason === "replaced"
          ) {
            if (command.type !== "stop") return reject("disconnected");
            // 이미 다른 곡이 흐르고 있어요. 그 곡을 멈추지 않고 완료만 확인해요.
            owned.context = command.context;
            terminal = null;
            replaced = true;
            return { status: "accepted", context: command.context };
          }
          if (
            command.type === "seek" &&
            (!Number.isFinite(command.positionSec) || command.positionSec < 0)
          ) {
            return reject("configuration");
          }
          const action = commandAction(command);
          const controlTarget =
            command.type === "stop" &&
            terminal?.state === "ended" &&
            terminal.endReason === "owned-advance" &&
            advancedNative
              ? advancedNative
              : owned.native;
          previous = null;
          try {
            const result = await options.runScript(
              controlScript(controlTarget, action),
              combined,
            );
            if (result === "mismatch") {
              owned = null;
              previous = null;
              return reject("disconnected");
            }
            if (result !== "applied" || combined.aborted) {
              owned = null;
              return {
                status: "unknown",
                context: command.context,
                error: { code: "unknown-outcome" },
              };
            }
            owned.context = command.context;
            stopTarget = command.type === "stop" ? controlTarget : null;
            previous = null;
            terminal = null;
          } catch {
            owned = null;
            return {
              status: "unknown",
              context: command.context,
              error: { code: "unknown-outcome" },
            };
          }
        }
        return { status: "accepted", context: command.context };
      });
    },
    observe(signal) {
      const subscriber = stream(signal);
      if (!signal.aborted && !isDisposed) {
        // next()보다 구독 시점에 수집을 시작해 첫 현재 snapshot을 제공해요.
        cancelPoll?.();
        poll();
      }
      return subscriber.iterator;
    },
    reconcile(binding, signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        if (isDisposed || !connected) {
          return { ok: false, error: { code: "disconnected" } };
        }
        const candidate = fromBinding(binding, connected);
        if (!candidate) {
          return { ok: true, value: { status: "unknown" } };
        }
        try {
          const native = parseSnapshot(
            await options.runScript(
              snapshotScript,
              AbortSignal.any([signal, lifetime.signal]),
            ),
          );
          signal.throwIfAborted();
          if (isDisposed) {
            return { ok: false, error: { code: "disconnected" } };
          }
          if (!native || native.state === "stopped") {
            return { ok: true, value: { status: "unknown" } };
          }
          if (!sameNative(candidate.native, native)) {
            return {
              ok: true,
              value: {
                status: "mismatch",
                observation: observation(native, "unknown", null),
              },
            };
          }
          owned = { ...candidate, native };
          previous = native;
          terminal = null;
          return {
            ok: true,
            value: {
              status: "match",
              observation: observation(native, native.state),
            },
          };
        } catch {
          signal.throwIfAborted();
          return { ok: true, value: { status: "unknown" } };
        }
      });
    },
    async dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      lifetime.abort();
      cancelPoll?.();
      cancelPoll = null;
      for (const subscriber of [...streams]) {
        subscriber.close();
      }
      await queue;
      connected = null;
      owned = null;
      previous = null;
      terminal = null;
      replaced = false;
    },
  };

  const notConnected = () =>
    isDisposed || !connected
      ? ({
          ok: false,
          error: { code: options.unavailable ?? "disconnected" },
        } as const)
      : null;

  const background: BackgroundPort = {
    listPlaylists(signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        const unavailable = notConnected();
        if (unavailable) return unavailable;
        try {
          const output = await options.runScript(
            playlistsScript(),
            AbortSignal.any([signal, lifetime.signal]),
          );
          return {
            ok: true,
            value: [
              ...new Set(
                output
                  .split("\x1f")
                  .map((name) => name.trim())
                  .filter(Boolean),
              ),
            ],
          };
        } catch {
          signal.throwIfAborted();
          return { ok: false, error: { code: "disconnected" } };
        }
      });
    },
    start(playlist, signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        const unavailable = notConnected();
        if (unavailable) return unavailable;
        // 신청곡을 재생 중이면 배경 음악으로 덮지 않아요.
        if (owned && !replaced && !terminal && !stopTarget) {
          return { ok: false, error: { code: "configuration" } };
        }
        try {
          const current = await options.runScript(
            startPlaylistScript(playlist),
            AbortSignal.any([signal, lifetime.signal]),
          );
          owned = null;
          previous = null;
          terminal = null;
          stopTarget = null;
          advancedNative = null;
          replaced = false;
          return sameText(current, playlist)
            ? { ok: true, value: undefined }
            : { ok: false, error: { code: "unknown-outcome" } };
        } catch {
          signal.throwIfAborted();
          return { ok: false, error: { code: "unknown-outcome" } };
        }
      });
    },
    fadeOut(durationMs, signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        const unavailable = notConnected();
        if (unavailable) return unavailable;
        try {
          await options.runScript(
            fadeOutScript(durationMs),
            AbortSignal.any([signal, lifetime.signal]),
          );
          return { ok: true, value: undefined };
        } catch {
          signal.throwIfAborted();
          return { ok: false, error: { code: "unknown-outcome" } };
        }
      });
    },
    observe(signal) {
      return serialize(async () => {
        signal.throwIfAborted();
        const unavailable = notConnected();
        if (unavailable) return unavailable;
        try {
          const parsed = parseBackground(
            await options.runScript(
              backgroundScript,
              AbortSignal.any([signal, lifetime.signal]),
            ),
          );
          return parsed
            ? { ok: true, value: parsed }
            : { ok: false, error: { code: "disconnected" } };
        } catch {
          signal.throwIfAborted();
          return { ok: false, error: { code: "disconnected" } };
        }
      });
    },
  };
  return { connection, playback, background };
}

function parseBackground(output: string): BackgroundObservation | null {
  const fields = output.trim().split("\x1f");
  const [state, key, title, artist, playlist, position, duration] = fields;
  if (
    fields.length !== 7 ||
    (state !== "playing" && state !== "paused" && state !== "stopped")
  ) {
    return null;
  }
  const number = (text: string | undefined) => {
    const parsed = text?.trim() ? Number(text) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    state,
    trackKey: key || null,
    title: title || null,
    artist: artist || null,
    playlist: playlist || null,
    positionSec: number(position),
    durationSec: number(duration),
  };
}

function commandAction(
  command: Exclude<PlaybackCommand, { type: "play" }>,
): string {
  switch (command.type) {
    case "pause":
      return "pause";
    case "resume":
      return "play";
    case "stop":
      return "stop";
    case "restart":
      return `set player position to 0\n  ${command.initialState === "paused" ? "pause" : "play"}`;
    case "seek":
      return `set player position to ${command.positionSec}`;
  }
}
