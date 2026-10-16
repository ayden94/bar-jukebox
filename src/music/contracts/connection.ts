import type { ModeId, ProviderId } from "./catalog";
import type { MusicResult } from "./errors";

export type ExecutionLocation = "server" | "browser";

export interface PlaybackCapabilities {
  readonly canPlayExactTrack: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
  readonly canRestart: boolean;
  readonly canObserveEnd: boolean;
  readonly canSeek: boolean;
}

export interface PlaybackTarget {
  readonly providerId: ProviderId;
  readonly modeId: ModeId;
  readonly targetId: string;
}

export interface ConnectionTarget {
  readonly ref: PlaybackTarget;
  readonly label: string;
  readonly location: ExecutionLocation;
}

export interface ConnectedTarget {
  readonly target: PlaybackTarget;
  // 재연결마다 달라져요. 이전 연결의 명령과 관측을 구분해요.
  readonly connectionGeneration: string;
  readonly location: ExecutionLocation;
  readonly capabilities: PlaybackCapabilities;
}

export interface ConnectionPort {
  listTargets(
    signal: AbortSignal,
  ): Promise<MusicResult<readonly ConnectionTarget[]>>;
  // 기기 연결일 뿐 앱의 owner 획득이나 재생 허가가 아니에요.
  connect(
    target: PlaybackTarget,
    signal: AbortSignal,
  ): Promise<MusicResult<ConnectedTarget>>;
  disconnect(signal: AbortSignal): Promise<MusicResult<void>>;
}
