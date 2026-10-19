import type { AuthPort } from "./auth";
import type { BackgroundPort } from "./background";
import type { CatalogPort, ModeId, ProviderId } from "./catalog";
import type {
  ConnectionPort,
  ExecutionLocation,
  PlaybackCapabilities,
} from "./connection";
import type { MusicResult } from "./errors";
import type { PlaybackPort } from "./playback";

export interface ProviderIdentity {
  readonly providerId: ProviderId;
  readonly modeId: ModeId;
}

export interface PlaybackModeDescriptor {
  readonly modeId: ModeId;
  readonly location: ExecutionLocation;
  readonly capabilities: PlaybackCapabilities;
}

// 순수 값이에요. descriptor import만으로 초기화나 외부 호출을 하지 않아요.
export interface ProviderDescriptor {
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly modes: readonly PlaybackModeDescriptor[];
}

export interface PlaybackRuntime {
  readonly connection: ConnectionPort;
  readonly playback: PlaybackPort;
  // 선택 기능이에요. 없으면 신청이 없을 때 아무것도 재생하지 않아요.
  readonly background?: BackgroundPort;
}

export interface ServerMusicProvider {
  readonly identity: ProviderIdentity;
  readonly catalog: CatalogPort;
  readonly auth: AuthPort;
  readonly execution:
    | { readonly location: "server"; readonly runtime: PlaybackRuntime }
    | { readonly location: "browser" };
  // 모든 포트와 진행 중 구독을 정리해요. 반복 호출해도 안전해요.
  dispose(): Promise<void>;
}

export interface BrowserMusicProvider {
  readonly identity: ProviderIdentity;
  readonly auth: AuthPort;
  readonly runtime: PlaybackRuntime;
  dispose(): Promise<void>;
}

// Options는 각 구현의 비공개 설정·의존성 타입이에요. 공통 토큰 틀을 강요하지 않아요.
// factory 호출이 명시적 초기화이며 실패/취소 시 부분 생성 자원을 남기지 않아요.
// 조립 시 descriptor와 양쪽 identity의 providerId + modeId를 검증해야 해요.
export type ServerProviderFactory<Options> = (
  options: Options,
  signal: AbortSignal,
) => Promise<MusicResult<ServerMusicProvider>>;

export type BrowserProviderFactory<Options> = (
  options: Options,
  signal: AbortSignal,
) => Promise<MusicResult<BrowserMusicProvider>>;
