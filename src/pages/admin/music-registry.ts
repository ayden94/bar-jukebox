import { musicModeUnavailableReason } from "../../music/availability";
import type {
  BrowserProviderFactory,
  CatalogPort,
  MusicResult,
  ProviderIdentity,
} from "../../music/contracts";
import { createAppleMusicBrowser } from "../../music/providers/apple-music/browser";

export type BrowserMusicOptions = {
  readonly api: (path: string, options?: RequestInit) => Promise<Response>;
  readonly registerCatalog: (port: CatalogPort) => () => void;
};

export type SelectedBrowserFactory =
  BrowserProviderFactory<BrowserMusicOptions>;

// SDK 구현은 선택된 조합의 정적 import로만 연결해요. 테스트 주입은 QA 빌드의
// 이 모듈 경계에서만 하며 production 환경 변수나 window registry를 쓰지 않아요.
export async function loadBrowserMusicFactory(
  selected: ProviderIdentity,
  signal: AbortSignal,
): Promise<MusicResult<SelectedBrowserFactory>> {
  signal.throwIfAborted();
  if (musicModeUnavailableReason(selected, "browser"))
    return { ok: false, error: { code: "unsupported" } };
  if (selected.providerId === "apple-music" && selected.modeId === "musickit") {
    return { ok: true, value: createAppleMusicBrowser };
  }
  if (
    selected.providerId === "youtube-music" &&
    selected.modeId === "browser-companion"
  ) {
    return { ok: false, error: { code: "unsupported" } };
  }
  return { ok: false, error: { code: "configuration" } };
}
