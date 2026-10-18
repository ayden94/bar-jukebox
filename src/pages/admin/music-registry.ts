import type {
  BrowserProviderFactory,
  MusicResult,
  ProviderIdentity,
} from "../../music/contracts";

export type BrowserMusicOptions = {
  readonly api: (path: string, options?: RequestInit) => Promise<Response>;
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
  if (
    (selected.providerId === "apple-music" && selected.modeId === "musickit") ||
    (selected.providerId === "youtube-music" &&
      selected.modeId === "browser-companion")
  ) {
    return { ok: false, error: { code: "unsupported" } };
  }
  return { ok: false, error: { code: "configuration" } };
}
