import type { MusicResult } from "./errors";

export type ProviderId = string;
export type ModeId = string;

export interface TrackRef {
  readonly providerId: ProviderId;
  // 공급자 문자열을 숫자로 바꾸거나 대소문자를 정규화하지 않아요.
  readonly trackId: string;
}

export interface ArtworkRef {
  readonly providerId: ProviderId;
  readonly artworkId: string;
}

export interface TrackMetadata {
  readonly ref: TrackRef;
  readonly title: string;
  readonly artist: string;
  // 유한한 0 이상의 초예요. null은 길이를 모른다는 뜻이며 종료 근거가 아니에요.
  readonly durationSec: number | null;
  readonly artwork: ArtworkRef | null;
  readonly sourceUrl: string | null;
}

export interface CatalogPage {
  readonly tracks: readonly TrackMetadata[];
  // 페이지 크기와 cursor 해석은 공급자가 소유해요.
  readonly nextCursor: string | null;
}

export interface CatalogPort {
  search(
    query: string,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<MusicResult<CatalogPage>>;
  // 메타데이터와 재생 가능 여부를 검증해요. 외부 원시 자료는 반환하지 않아요.
  lookup(
    ref: TrackRef,
    signal: AbortSignal,
  ): Promise<MusicResult<TrackMetadata>>;
}
