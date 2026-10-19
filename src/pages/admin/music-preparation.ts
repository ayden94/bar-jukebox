import type { PlaybackSnapshot } from "../../domains/playback/protocol";
import type { BrowserHostState } from "./browser-music-lifecycle";
import type { MusicSnapshot } from "./music-types";

type PreparationInput = {
  readonly snapshot: MusicSnapshot | null;
  readonly playback: PlaybackSnapshot | null;
  readonly state: BrowserHostState;
  readonly fresh: boolean;
};

export function browserPreparation({
  snapshot,
  playback,
  state,
  fresh,
}: PreparationInput) {
  if (!fresh || !snapshot || !playback) return "unknown";
  if (snapshot.readiness === "disabled" || snapshot.readiness === "conflict")
    return "blocked";
  if (snapshot.readiness === "setup-required") return "installation-required";
  // 일반 인증 실패를 토큰 부재로 추측하지 않고 서버의 설치 사유만 사용해요.
  if (
    snapshot.active?.providerId === "apple-music" &&
    snapshot.active.modeId === "musickit" &&
    snapshot.reason?.includes("MUSICKIT_DEVELOPER_TOKEN")
  )
    return "installation-required";
  if (!snapshot.auth) return "unavailable";
  if (
    state.phase === "loading" ||
    state.phase === "authorizing" ||
    state.phase === "connecting" ||
    state.phase === "claiming" ||
    state.phase === "disconnecting"
  )
    return "preparing";
  const owner = playback.owner?.released ? null : playback.owner;
  if (
    (snapshot.owner?.executorSessionId ?? null) !==
    (owner?.executorSessionId ?? null)
  )
    return "unknown";
  if (owner) {
    if (playback.ownerConnected && snapshot.readiness !== "ready")
      return "unknown";
    if (state.phase === "connected" && playback.ownerConnected)
      return "connected";
    if (state.phase !== "unknown" && playback.ownerConnected)
      return "controller";
    return "recovery-required";
  }
  if (state.phase === "connected") return "unknown";
  return "connect";
}
