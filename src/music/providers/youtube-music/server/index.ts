import type {
  ArtworkPort,
  AuthState,
  CatalogPort,
  MusicResult,
  ServerMusicProvider,
} from "../../../contracts";
import { createYouTubeCatalog, type YouTubeArtworkFetch } from "./catalog";

export async function createYouTubeMusicServer(
  options: { transport: CatalogPort; fetch?: YouTubeArtworkFetch },
  signal: AbortSignal,
): Promise<
  MusicResult<ServerMusicProvider & { readonly artwork: ArtworkPort }>
> {
  signal.throwIfAborted();
  const catalog = createYouTubeCatalog(options.transport, options.fetch);
  let disposed = false;
  const getState = (): AuthState => ({
    status: disposed ? "disconnected" : "reauth-required",
    authorization: "none",
    action: disposed
      ? null
      : {
          kind: "user-gesture",
          label:
            "관리자 브라우저에서 로그인한 YouTube Music 탭을 연결해주세요.",
        },
  });
  return {
    ok: true,
    value: {
      identity: { providerId: "youtube-music", modeId: "browser-companion" },
      catalog: catalog.catalog,
      artwork: catalog.artwork,
      execution: { location: "browser" },
      auth: {
        getState,
        async connect(signal) {
          signal.throwIfAborted();
          return {
            ok: false,
            error: { code: disposed ? "disconnected" : "auth-required" },
          };
        },
        async disconnect(signal) {
          signal.throwIfAborted();
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
