import type { ModeId, ProviderId, TrackRef } from "./catalog";
import type { PlaybackTarget } from "./connection";
import type { MusicError, MusicErrorCode, MusicResult } from "./errors";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface NativeBinding {
  readonly providerId: ProviderId;
  readonly modeId: ModeId;
  readonly version: number;
  // 공급자만 해석·검증하는 JSON-safe 자료예요. 비밀과 공개 메타데이터가 아니에요.
  readonly payload: JsonValue;
}

export interface PlaybackCorrelation {
  readonly commandId: string;
  readonly attemptId: string;
  readonly executorSessionId: string;
}

export interface PlaybackContext extends PlaybackCorrelation {
  readonly target: PlaybackTarget;
  readonly connectionGeneration: string;
}

export type InitialPlaybackState = "playing" | "paused";

export type PlaybackCommand = {
  readonly context: PlaybackContext;
} & (
  | {
      readonly type: "play";
      readonly trackRef: TrackRef;
      readonly initialState: InitialPlaybackState;
    }
  | { readonly type: "pause" | "resume" | "stop" }
  // 현재 곡을 처음부터 준비해요. native seek가 없어도 재로딩으로 구현할 수 있어요.
  | { readonly type: "restart"; readonly initialState: InitialPlaybackState }
  | { readonly type: "seek"; readonly positionSec: number }
);

export type CommandOutcome =
  | { readonly status: "accepted"; readonly context: PlaybackContext }
  | {
      readonly status: "rejected";
      readonly context: PlaybackContext;
      readonly error: MusicError & {
        readonly code: Exclude<MusicErrorCode, "unknown-outcome">;
      };
    }
  | {
      readonly status: "unknown";
      readonly context: PlaybackContext;
      readonly error: MusicError & { readonly code: "unknown-outcome" };
    };

export type PlaybackState =
  | "playing"
  | "paused"
  | "buffering"
  | "interrupted"
  | "ended"
  | "unavailable"
  | "unknown";

export type PlaybackObservation = {
  readonly trackRef: TrackRef | null;
  readonly target: PlaybackTarget | null;
  readonly connectionGeneration: string | null;
  readonly correlation: PlaybackCorrelation | null;
  readonly binding: NativeBinding | null;
  // 실행기·연결 세대 안에서 증가하는 관측 순서예요. 전송 도착 순서가 아니에요.
  readonly sequence: number;
  readonly positionSec: number | null;
  readonly durationSec: number | null;
} & (
  | {
      readonly state: "ended";
      // 시간 경과, 위치 0, 정지, ID 변경만으로 ended를 합성하지 않아요.
      readonly endReason: "natural-end" | "owned-advance";
    }
  | {
      readonly state: Exclude<PlaybackState, "ended">;
      readonly endReason?: never;
    }
);

export type Reconciliation =
  | { readonly status: "match"; readonly observation: PlaybackObservation }
  | { readonly status: "mismatch"; readonly observation: PlaybackObservation }
  | { readonly status: "unknown" };

export interface PlaybackPort {
  // accepted는 접수만 뜻해요. playing/완료는 일치하는 관측으로만 확인해요.
  execute(
    command: PlaybackCommand,
    signal: AbortSignal,
  ): Promise<CommandOutcome>;
  // 호출 시 구독하고 첫 값은 현재 snapshot이에요. abort/return/dispose는
  // 대기 중 next까지 done으로 끝내고 버퍼·리스너를 해제해요.
  observe(
    signal: AbortSignal,
  ): AsyncIterableIterator<PlaybackObservation, undefined>;
  // binding의 정확한 일치를 증명하지 못하면 unknown이에요.
  reconcile(
    binding: NativeBinding,
    signal: AbortSignal,
  ): Promise<MusicResult<Reconciliation>>;
  // 멱등이에요. 이후 명령은 disconnected로 거절하며 dispose는 stop의 증거가 아니에요.
  dispose(): Promise<void>;
}
