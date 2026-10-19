import { musicModeUnavailableReason } from "./availability";
import type {
  ArtworkPort,
  BrowserMusicProvider,
  CatalogPort,
  MusicResult,
  ProviderDescriptor,
  ProviderIdentity,
  ServerMusicProvider,
} from "./contracts";
import { appleMusicDescriptor } from "./providers/apple-music";
import { youtubeMusicDescriptor } from "./providers/youtube-music";

export const musicDescriptors: readonly ProviderDescriptor[] = [
  appleMusicDescriptor,
  youtubeMusicDescriptor,
];

export const requiredPlaybackCapabilities = [
  "canPlayExactTrack",
  "canPause",
  "canResume",
  "canStop",
  "canRestart",
  "canObserveEnd",
] as const;

export type MusicServerOptions = {
  readonly disabled: boolean;
  readonly platform: string;
  readonly musickitDeveloperToken?: string;
  readonly catalogTransport?: CatalogPort;
  readonly appleMusicCountry?: string;
};

// 구현이 없는 조합도 등록은 유지해요. 선택된 공개 factory만 불러와요.
export async function loadMusicServer(
  selected: ProviderIdentity,
  options: MusicServerOptions,
  signal: AbortSignal,
): Promise<
  MusicResult<ServerMusicProvider & { readonly artwork: ArtworkPort }>
> {
  signal.throwIfAborted();
  const registered = musicDescriptors.some(
    (descriptor) =>
      descriptor.providerId === selected.providerId &&
      descriptor.modes.some((mode) => mode.modeId === selected.modeId),
  );
  if (registered && musicModeUnavailableReason(selected, options.platform))
    return { ok: false, error: { code: "unsupported" } };
  if (selected.providerId === "apple-music") {
    switch (selected.modeId) {
      case "applescript": {
        const { createAppleMusicServer } = await import(
          "./providers/apple-music/server"
        );
        signal.throwIfAborted();
        return createAppleMusicServer(
          { ...options, country: options.appleMusicCountry },
          signal,
        );
      }
      case "musickit": {
        const { createAppleMusicKitServer } = await import(
          "./providers/apple-music/server"
        );
        signal.throwIfAborted();
        return createAppleMusicKitServer(
          { developerToken: options.musickitDeveloperToken },
          signal,
        );
      }
    }
  }
  if (
    selected.providerId === "youtube-music" &&
    selected.modeId === "browser-companion"
  ) {
    if (!options.catalogTransport)
      return { ok: false, error: { code: "configuration" } };
    const { createYouTubeMusicServer } = await import(
      "./providers/youtube-music/server"
    );
    signal.throwIfAborted();
    return createYouTubeMusicServer(
      { transport: options.catalogTransport },
      signal,
    );
  }
  return { ok: false, error: { code: "configuration" } };
}

// 서버와 브라우저 조립이 같은 identity·위치·필수 기능 계약을 확인해요.
export async function validateMusicProvider(
  descriptor: ProviderDescriptor,
  selected: ProviderIdentity,
  provider: ServerMusicProvider | BrowserMusicProvider,
): Promise<void> {
  const mode = descriptor.modes.find(
    (entry) => entry.modeId === selected.modeId,
  );
  const location =
    "execution" in provider ? provider.execution.location : "browser";
  if (
    descriptor.providerId !== selected.providerId ||
    provider.identity.providerId !== selected.providerId ||
    provider.identity.modeId !== selected.modeId ||
    !mode ||
    mode.location !== location ||
    requiredPlaybackCapabilities.some((key) => !mode.capabilities[key])
  ) {
    await provider.dispose();
    throw new Error("등록한 음악 서비스와 실행 방식이 일치하지 않아요");
  }
}
