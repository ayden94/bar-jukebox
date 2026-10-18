import type {
  ArtworkPort,
  AuthState,
  MusicResult,
  ServerMusicProvider,
} from "../../../contracts/index";
import { type AppleFetch, createAppleCatalog } from "./catalog";
import { runAppleScript, type ScriptRunner } from "./native";
import { createApplePlayback, type PollScheduler } from "./playback";

export { getMusicKitDeveloperToken } from "./developer-token";
export { createAppleMusicKitServer } from "./musickit";

type AppleMusicServerOptions = {
  fetch?: AppleFetch;
  runScript?: ScriptRunner;
  platform?: string;
  disabled?: boolean;
  pollIntervalMs?: number;
  schedulePoll?: PollScheduler;
};

export async function createAppleMusicServer(
  options: AppleMusicServerOptions,
  signal: AbortSignal,
): Promise<
  MusicResult<ServerMusicProvider & { readonly artwork: ArtworkPort }>
> {
  signal.throwIfAborted();
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
    return { ok: false, error: { code: "configuration" } };
  }
  const unavailable = options.disabled
    ? "configuration"
    : (options.platform ?? process.platform) !== "darwin"
      ? "unsupported"
      : null;
  const catalog = createAppleCatalog(options.fetch ?? fetch);
  const runtime = createApplePlayback({
    runScript: options.runScript ?? runAppleScript,
    resolve: catalog.resolve,
    unavailable,
    pollIntervalMs,
    schedulePoll:
      options.schedulePoll ??
      ((callback, milliseconds) => {
        const timer = setTimeout(callback, milliseconds);
        return () => clearTimeout(timer);
      }),
  });
  let isDisposed = false;
  // Music.app의 사용자 로그인과 구독 여부는 AppleScript로 증명하지 않아요.
  // 이 권한은 공개 iTunes 카탈로그를 사용하는 서비스 권한만 뜻해요.
  let auth: AuthState = {
    status: "disconnected",
    authorization: "none",
    action: null,
  };
  return {
    ok: true,
    value: {
      identity: { providerId: "apple-music", modeId: "applescript" },
      catalog: catalog.catalog,
      artwork: catalog.artwork,
      auth: {
        getState: () => auth,
        async connect(authSignal) {
          authSignal.throwIfAborted();
          if (isDisposed || unavailable) {
            return {
              ok: false,
              error: { code: isDisposed ? "disconnected" : unavailable! },
            };
          }
          auth = {
            status: "authorized",
            authorization: "service",
            action: null,
          };
          return { ok: true, value: auth };
        },
        async disconnect(authSignal) {
          authSignal.throwIfAborted();
          auth = {
            status: "disconnected",
            authorization: "none",
            action: null,
          };
          return { ok: true, value: auth };
        },
      },
      execution: { location: "server", runtime },
      async dispose() {
        if (isDisposed) {
          return;
        }
        isDisposed = true;
        auth = { status: "disconnected", authorization: "none", action: null };
        catalog.dispose();
        await runtime.playback.dispose();
      },
    },
  };
}
