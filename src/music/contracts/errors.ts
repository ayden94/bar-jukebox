export type MusicErrorCode =
  | "invalid-track"
  | "unplayable"
  | "auth-required"
  | "permission-denied"
  | "disconnected"
  | "rate-limited"
  | "unsupported"
  | "configuration"
  | "unknown-outcome";

export interface MusicError {
  readonly code: MusicErrorCode;
  // 공급자가 명시한 경우만 채워요. 원시 오류와 자격증명은 공개하지 않아요.
  readonly retryAfterSec?: number;
}

export type MusicResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MusicError };

// 비명령 작업과 발행 전 명령은 취소 시 signal.reason으로 reject해요.
// 발행 후 적용 여부를 모르면 취소를 확정 실패로 바꾸지 않고 unknown을 반환해요.
