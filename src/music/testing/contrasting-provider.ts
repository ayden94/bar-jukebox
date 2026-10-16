import type {
  AuthState,
  CommandOutcome,
  ConnectedTarget,
  ExecutionLocation,
  MusicErrorCode,
  MusicResult,
  NativeBinding,
  PlaybackCapabilities,
  PlaybackCommand,
  PlaybackObservation,
  PlaybackRuntime,
  ProviderDescriptor,
  ServerMusicProvider,
  ServerProviderFactory,
  TrackMetadata,
  TrackRef,
} from "../contracts/index";
import { createObservationStream } from "./observation-stream";

interface ContrastingProviderOptions {
  providerId?: string;
  modeId?: string;
  tracks?: readonly unknown[];
  pageSize?: number;
  capabilities?: Partial<PlaybackCapabilities>;
  location?: ExecutionLocation;
}

type PlannedOutcome =
  | { status: "accepted" }
  | { status: "rejected"; code: Exclude<MusicErrorCode, "unknown-outcome"> }
  | { status: "unknown"; applies: boolean };

export interface ContrastingProviderControls {
  pendingSequences(): readonly number[];
  deliver(sequence: number): void;
  setNextOutcome(outcome: PlannedOutcome): void;
  advanceTo(positionSec: number): void;
  finishNaturally(): void;
  readonly subscriberCount: number;
}

export interface ContrastingProviderFixture {
  readonly descriptor: ProviderDescriptor;
  readonly provider: ServerMusicProvider;
  readonly runtime: PlaybackRuntime;
  readonly controls: ContrastingProviderControls;
}

function failure<T>(code: MusicErrorCode): MusicResult<T> {
  return { ok: false, error: { code } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 앨범 없이 서비스 권한으로 재생하며, 관측 전달은 테스트가 직접 진행해요.
export function createContrastingProvider(
  options: ContrastingProviderOptions = {},
): ContrastingProviderFixture {
  const identity = {
    providerId: options.providerId ?? "test-radio",
    modeId: options.modeId ?? "service-player",
  };
  const capabilities: PlaybackCapabilities = {
    canPlayExactTrack: true,
    canPause: true,
    canResume: true,
    canStop: true,
    canRestart: true,
    canObserveEnd: true,
    canSeek: false,
    ...options.capabilities,
  };
  const location = options.location ?? "server";
  const descriptor: ProviderDescriptor = {
    providerId: identity.providerId,
    displayName: "계약 검증용 라디오",
    modes: [{ modeId: identity.modeId, location, capabilities }],
  };
  const target = { ...identity, targetId: "speaker:anywhere" };
  const rows = options.tracks ?? [
    {
      id: "Mix:Aa/_?한글",
      title: "첫 소리",
      artist: "라디오",
      seconds: null,
      kind: "audio",
    },
    {
      id: "mix:aa/_?한글",
      title: "다음 소리",
      artist: "라디오",
      seconds: 98.5,
      kind: "audio",
    },
  ];
  const pageSize = options.pageSize ?? 1;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    identity.providerId === "" ||
    identity.modeId === ""
  ) {
    throw new Error("테스트 공급자 설정이 잘못됐어요");
  }
  const observers = new Set<ReturnType<typeof createObservationStream>>();
  const pending = new Map<number, PlaybackObservation>();
  const nativeSession = crypto.randomUUID();
  let auth: AuthState = {
    status: "disconnected",
    authorization: "service",
    action: null,
  };
  let connection: ConnectedTarget | null = null;
  let generation = 0;
  let loads = 0;
  let isDisposed = false;
  let nextOutcome: PlannedOutcome = { status: "accepted" };
  let current: PlaybackObservation = {
    trackRef: null,
    target: null,
    connectionGeneration: null,
    correlation: null,
    binding: null,
    sequence: 0,
    positionSec: null,
    durationSec: null,
    state: "unknown",
  };

  function capture(snapshot: PlaybackObservation, delayed = true) {
    current = { ...snapshot, sequence: current.sequence + 1 };
    if (delayed) {
      pending.set(current.sequence, current);
    } else {
      for (const observer of observers) {
        observer.push(current);
      }
    }
  }

  function readRow(row: unknown): MusicResult<TrackMetadata> {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      typeof row.title !== "string" ||
      row.title.length === 0 ||
      typeof row.artist !== "string" ||
      !(
        row.seconds === null ||
        (typeof row.seconds === "number" &&
          Number.isFinite(row.seconds) &&
          row.seconds >= 0)
      )
    ) {
      return failure("invalid-track");
    }
    if (row.kind !== "audio") {
      return failure("unplayable");
    }
    return {
      ok: true,
      value: {
        ref: { providerId: identity.providerId, trackId: row.id },
        title: row.title,
        artist: row.artist,
        durationSec: row.seconds,
        artwork: null,
        sourceUrl: null,
      },
    };
  }

  function lookup(ref: TrackRef): MusicResult<TrackMetadata> {
    if (ref.providerId !== identity.providerId) {
      return failure("invalid-track");
    }
    const row = rows.find((row) => isRecord(row) && row.id === ref.trackId);
    return readRow(row);
  }

  function unavailable(signal: AbortSignal): boolean {
    signal.throwIfAborted();
    return isDisposed;
  }

  function disconnect() {
    connection = null;
    capture(
      {
        ...current,
        target: null,
        connectionGeneration: null,
        correlation: null,
        trackRef: null,
        binding: null,
        positionSec: null,
        durationSec: null,
        state: "unavailable",
        endReason: undefined,
      },
      false,
    );
  }

  async function dispose() {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    auth = { ...auth, status: "disconnected" };
    connection = null;
    pending.clear();
    for (const observer of observers) {
      observer.close();
    }
  }

  function rejected(
    command: PlaybackCommand,
    code: MusicErrorCode,
  ): CommandOutcome {
    if (code === "unknown-outcome") {
      return { status: "unknown", context: command.context, error: { code } };
    }
    return { status: "rejected", context: command.context, error: { code } };
  }

  const runtime: PlaybackRuntime = {
    connection: {
      async listTargets(signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        return {
          ok: true,
          value: [{ ref: target, label: "테스트 스피커", location }],
        };
      },
      async connect(requested, signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        if (auth.status !== "authorized") {
          return failure("auth-required");
        }
        if (
          requested.providerId !== target.providerId ||
          requested.modeId !== target.modeId ||
          requested.targetId !== target.targetId
        ) {
          return failure("configuration");
        }
        connection = {
          target,
          connectionGeneration: `connection:${++generation}`,
          location,
          capabilities,
        };
        capture(
          {
            ...current,
            target,
            connectionGeneration: connection.connectionGeneration,
            correlation: null,
            binding: null,
            trackRef: null,
            positionSec: null,
            durationSec: null,
            state: "unknown",
            endReason: undefined,
          },
          false,
        );
        return { ok: true, value: connection };
      },
      async disconnect(signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        disconnect();
        return { ok: true, value: undefined };
      },
    },
    playback: {
      async execute(command, signal) {
        if (unavailable(signal)) {
          return rejected(command, "disconnected");
        }
        if (auth.status !== "authorized") {
          return rejected(command, "auth-required");
        }
        if (
          !connection ||
          command.context.connectionGeneration !==
            connection.connectionGeneration ||
          command.context.target.providerId !== target.providerId ||
          command.context.target.modeId !== target.modeId ||
          command.context.target.targetId !== target.targetId
        ) {
          return rejected(command, "disconnected");
        }
        const allowed = {
          play: capabilities.canPlayExactTrack,
          pause: capabilities.canPause,
          resume: capabilities.canResume,
          stop: capabilities.canStop,
          restart: capabilities.canRestart,
          seek: capabilities.canSeek,
        };
        if (!allowed[command.type]) {
          return rejected(command, "unsupported");
        }
        const track = command.type === "play" ? lookup(command.trackRef) : null;
        if (track && !track.ok) {
          return rejected(command, track.error.code);
        }
        if (command.type !== "play" && !current.trackRef) {
          return rejected(command, "unplayable");
        }
        if (
          command.type !== "play" &&
          command.type !== "restart" &&
          (current.correlation?.attemptId !== command.context.attemptId ||
            current.correlation.executorSessionId !==
              command.context.executorSessionId)
        ) {
          return rejected(command, "disconnected");
        }
        if (
          command.type === "seek" &&
          (!Number.isFinite(command.positionSec) || command.positionSec < 0)
        ) {
          return rejected(command, "configuration");
        }
        const outcome = nextOutcome;
        nextOutcome = { status: "accepted" };
        if (outcome.status === "rejected") {
          return rejected(command, outcome.code);
        }
        if (outcome.status !== "unknown" || outcome.applies) {
          const { commandId, attemptId, executorSessionId } = command.context;
          let snapshot: PlaybackObservation = {
            ...current,
            correlation: { commandId, attemptId, executorSessionId },
          };
          switch (command.type) {
            case "play":
            case "restart": {
              const ref = track?.ok ? track.value.ref : current.trackRef!;
              const binding: NativeBinding = {
                ...identity,
                version: 1,
                payload: {
                  nativeId: `${nativeSession}/load:${++loads}`,
                  trackId: ref.trackId,
                  attemptId,
                  executorSessionId,
                  connectionGeneration: connection.connectionGeneration,
                  targetId: target.targetId,
                },
              };
              snapshot = {
                ...snapshot,
                trackRef: ref,
                binding,
                positionSec: 0,
                durationSec: track?.ok
                  ? track.value.durationSec
                  : current.durationSec,
                state: command.initialState,
                endReason: undefined,
              };
              break;
            }
            case "pause":
            case "resume":
              snapshot = {
                ...snapshot,
                state: command.type === "pause" ? "paused" : "playing",
                endReason: undefined,
              };
              break;
            case "stop":
              snapshot = {
                ...snapshot,
                state: "stopped",
                trackRef: null,
                binding: null,
                positionSec: null,
                durationSec: null,
                endReason: undefined,
              };
              break;
            case "seek":
              snapshot = { ...snapshot, positionSec: command.positionSec };
              break;
          }
          capture(snapshot);
        }
        return outcome.status === "unknown"
          ? {
              status: "unknown",
              context: command.context,
              error: { code: "unknown-outcome" },
            }
          : { status: "accepted", context: command.context };
      },
      observe(signal) {
        const observer = createObservationStream(current, signal, () =>
          observers.delete(observer),
        );
        if (isDisposed) {
          observer.close();
        }
        if (!observer.isClosed) {
          observers.add(observer);
        }
        return observer.iterator;
      },
      async reconcile(binding, signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        const payload = binding.payload;
        if (
          !connection ||
          binding.providerId !== identity.providerId ||
          binding.modeId !== identity.modeId ||
          binding.version !== 1 ||
          !isRecord(payload) ||
          ![
            "nativeId",
            "trackId",
            "attemptId",
            "executorSessionId",
            "connectionGeneration",
            "targetId",
          ].every((key) => typeof payload[key] === "string") ||
          !current.binding ||
          !isRecord(current.binding.payload)
        ) {
          return { ok: true, value: { status: "unknown" } };
        }
        const actual = current.binding.payload;
        const matches = [
          "nativeId",
          "trackId",
          "attemptId",
          "executorSessionId",
          "connectionGeneration",
          "targetId",
        ].every((key) => payload[key] === actual[key]);
        return {
          ok: true,
          value: {
            status: matches ? "match" : "mismatch",
            observation: current,
          },
        };
      },
      dispose,
    },
  };

  const provider: ServerMusicProvider = {
    identity,
    catalog: {
      async search(query, cursor, signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        const tracks: TrackMetadata[] = [];
        for (const row of rows) {
          const result = readRow(row);
          if (!result.ok) {
            return result;
          }
          if (`${result.value.title} ${result.value.artist}`.includes(query)) {
            tracks.push(result.value);
          }
        }
        // cursor는 이 검색 결과의 페이지 경계에만 대응해요.
        const pages = new Map<string | null, number>([[null, 0]]);
        for (
          let offset = pageSize;
          offset < tracks.length;
          offset += pageSize
        ) {
          pages.set(
            `continuation:${encodeURIComponent(query)}:${offset}`,
            offset,
          );
        }
        const offset = pages.get(cursor);
        if (offset === undefined) {
          return failure("configuration");
        }
        const next = offset + pageSize;
        return {
          ok: true,
          value: {
            tracks: tracks.slice(offset, next),
            nextCursor:
              next < tracks.length
                ? `continuation:${encodeURIComponent(query)}:${next}`
                : null,
          },
        };
      },
      async lookup(ref, signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        return lookup(ref);
      },
    },
    auth: {
      getState: () => auth,
      async connect(signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        auth = { ...auth, status: "authorized" };
        return { ok: true, value: auth };
      },
      async disconnect(signal) {
        if (unavailable(signal)) {
          return failure("disconnected");
        }
        auth = { ...auth, status: "disconnected" };
        disconnect();
        return { ok: true, value: auth };
      },
    },
    execution: location === "server" ? { location, runtime } : { location },
    dispose,
  };

  return {
    descriptor,
    provider,
    runtime,
    controls: {
      pendingSequences: () => [...pending.keys()],
      deliver(sequence) {
        const snapshot = pending.get(sequence);
        if (!snapshot) {
          throw new Error("전달할 관측이 없어요");
        }
        pending.delete(sequence);
        for (const observer of observers) {
          observer.push(snapshot);
        }
      },
      setNextOutcome(outcome) {
        nextOutcome = outcome;
      },
      advanceTo(positionSec) {
        if (
          isDisposed ||
          !current.trackRef ||
          !Number.isFinite(positionSec) ||
          positionSec < 0
        ) {
          throw new Error("진행 위치를 관측할 재생이 없어요");
        }
        capture({ ...current, positionSec });
      },
      finishNaturally() {
        if (isDisposed || !current.trackRef || !capabilities.canObserveEnd) {
          throw new Error("자연 종료를 관측할 재생이 없어요");
        }
        capture({ ...current, state: "ended", endReason: "natural-end" });
      },
      get subscriberCount() {
        return observers.size;
      },
    },
  };
}

export const createContrastingServer: ServerProviderFactory<
  ContrastingProviderOptions
> = async (options, signal) => {
  signal.throwIfAborted();
  if (
    !Number.isSafeInteger(options.pageSize ?? 1) ||
    (options.pageSize ?? 1) < 1 ||
    options.providerId === "" ||
    options.modeId === ""
  ) {
    return failure("configuration");
  }
  return { ok: true, value: createContrastingProvider(options).provider };
};
