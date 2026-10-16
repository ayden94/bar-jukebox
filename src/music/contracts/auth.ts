import type { MusicResult } from "./errors";

export type AuthAction =
  | { readonly kind: "open-url"; readonly url: string }
  | { readonly kind: "user-gesture"; readonly label: string };

export interface AuthState {
  readonly status:
    | "disconnected"
    | "connecting"
    | "authorized"
    | "insufficient-permission"
    | "reauth-required";
  // 음악 권한의 주체예요. 앱 관리자 인증이나 실행기 소유권과 별개예요.
  readonly authorization: "none" | "service" | "user";
  readonly action: AuthAction | null;
}

export interface AuthPort {
  getState(): AuthState;
  // 토큰 모양과 전달 방식은 factory 구현 내부에 두어요.
  connect(signal: AbortSignal): Promise<MusicResult<AuthState>>;
  disconnect(signal: AbortSignal): Promise<MusicResult<AuthState>>;
}
