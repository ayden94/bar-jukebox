import type { MusicResult } from "./errors";

// 신청곡이 없을 때 흐르는 배경 음악이에요. 주크박스 신청과 소유권을 공유하지 않아요.
export type BackgroundObservation = {
  readonly state: "playing" | "paused" | "stopped";
  // 공급자 안에서만 의미 있는 현재 곡 식별자예요. 곡이 바뀌었는지 비교할 때만 써요.
  readonly trackKey: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  // 현재 재생 목록 이름이에요. 확인할 수 없으면 null이에요.
  readonly playlist: string | null;
  readonly positionSec: number | null;
  readonly durationSec: number | null;
};

export interface BackgroundPort {
  // 직원이 고를 수 있는 배경 재생 목록 이름이에요.
  listPlaylists(signal: AbortSignal): Promise<MusicResult<readonly string[]>>;
  // 지정한 목록을 셔플·반복으로 재생해요. 진행 중인 신청곡이 없을 때만 호출해요.
  start(playlist: string, signal: AbortSignal): Promise<MusicResult<void>>;
  // 음량을 서서히 줄여 정지한 뒤 원래 음량으로 되돌려요.
  fadeOut(durationMs: number, signal: AbortSignal): Promise<MusicResult<void>>;
  observe(signal: AbortSignal): Promise<MusicResult<BackgroundObservation>>;
}
