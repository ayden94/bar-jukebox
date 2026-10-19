import type {
  ArtworkPort,
  AuthState,
  MusicResult,
  ServerMusicProvider,
} from "../../../contracts/index";
import { type AppleFetch, createAppleCatalog } from "./catalog";
import { getMusicKitDeveloperToken } from "./developer-token";

type AppleMusicKitServerOptions = {
  readonly developerToken?: string;
  readonly fetch?: AppleFetch;
  readonly now?: () => number;
};

export async function createAppleMusicKitServer(
  options: AppleMusicKitServerOptions,
  signal: AbortSignal,
): Promise<
  MusicResult<ServerMusicProvider & { readonly artwork: ArtworkPort }>
> {
  signal.throwIfAborted();
  const token = options.developerToken;
  const now = options.now ?? Date.now;
  const catalog = createAppleCatalog(options.fetch ?? fetch);
  let disposed = false;
  const getState = (): AuthState => ({
    status: disposed ? "disconnected" : "reauth-required",
    authorization: "none",
    action: disposed
      ? null
      : {
          kind: "user-gesture",
          label: getMusicKitDeveloperToken(token, now()).ok
            ? "관리자 브라우저에서 Apple Music 계정을 연결해주세요."
            : "유효한 MUSICKIT_DEVELOPER_TOKEN을 설정하고 서버를 다시 시작해주세요.",
        },
  });
  return {
    ok: true,
    value: {
      identity: { providerId: "apple-music", modeId: "musickit" },
      catalog: catalog.catalog,
      artwork: catalog.artwork,
      execution: { location: "browser" },
      auth: {
        getState,
        async connect(authSignal) {
          authSignal.throwIfAborted();
          // 사용자 인증은 SDK가 있는 브라우저에서만 수행해요.
          return {
            ok: false,
            error: {
              code: disposed
                ? "disconnected"
                : getMusicKitDeveloperToken(token, now()).ok
                  ? "auth-required"
                  : "configuration",
            },
          };
        },
        async disconnect(authSignal) {
          authSignal.throwIfAborted();
          return { ok: true, value: getState() };
        },
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        catalog.dispose();
      },
    },
  };
}
