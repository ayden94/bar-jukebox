import type { ProviderDescriptor } from "../../music/contracts";

export type MusicConfig = {
  readonly providerId: string;
  readonly modeId: string;
};

export type MusicRegistration = {
  readonly descriptor: ProviderDescriptor;
  readonly modes: readonly {
    readonly modeId: string;
    readonly displayName: string;
    readonly available: boolean;
    readonly unavailableReason: string | null;
  }[];
};

export function registerMusicDescriptors(
  descriptors: readonly ProviderDescriptor[],
  platform: string,
): readonly MusicRegistration[] {
  return descriptors.map((descriptor) => ({
    descriptor,
    modes: descriptor.modes.map((mode) => {
      const native =
        descriptor.providerId === "apple-music" &&
        mode.modeId === "applescript";
      const available = !native || platform === "darwin";
      return {
        modeId: mode.modeId,
        displayName: native
          ? "이 Mac의 Music 앱"
          : mode.modeId === "musickit"
            ? "이 브라우저의 Apple Music"
            : "연결한 YouTube Music 탭",
        available,
        unavailableReason: available
          ? null
          : "이 재생 방식은 macOS의 Music 앱이 필요해요.",
      };
    }),
  }));
}

type ConfigSource = "environment" | "saved" | "default" | "unset";

export type MusicBootConfig = {
  readonly active: MusicConfig | null;
  readonly selected: MusicConfig;
  readonly locks: { readonly providerId: boolean; readonly modeId: boolean };
  readonly sources: {
    readonly providerId: ConfigSource;
    readonly modeId: ConfigSource;
  };
  readonly issue: string | null;
};

export function musicConfigIssue(
  config: MusicConfig,
  registry: readonly MusicRegistration[],
): string | null {
  if (!config.providerId || !config.modeId) {
    return "음악 서비스와 재생 방식을 선택해주세요.";
  }
  const provider = registry.find(
    (entry) => entry.descriptor.providerId === config.providerId,
  );
  const descriptor = provider?.descriptor.modes.find(
    (entry) => entry.modeId === config.modeId,
  );
  const mode = provider?.modes.find((entry) => entry.modeId === config.modeId);
  if (!descriptor || !mode) {
    return "등록되지 않은 음악 서비스 또는 재생 방식이에요.";
  }
  if (!mode.available) {
    return (
      mode.unavailableReason ?? "이 환경에서 지원하지 않는 재생 방식이에요."
    );
  }
  return null;
}

// 기본 조합과 환경별 지원 여부는 조립 지점에서 정해요.
export function resolveMusicBootConfig(options: {
  readonly environment: {
    readonly MUSIC_PROVIDER?: string;
    readonly MUSIC_PLAYBACK_MODE?: string;
  };
  readonly saved: MusicConfig | null;
  readonly legacyDefault: MusicConfig | null;
  readonly registry: readonly MusicRegistration[];
}): MusicBootConfig {
  const { environment, saved, legacyDefault, registry } = options;
  const locks = Object.freeze({
    providerId: environment.MUSIC_PROVIDER !== undefined,
    modeId: environment.MUSIC_PLAYBACK_MODE !== undefined,
  });
  const selected = Object.freeze({
    providerId:
      environment.MUSIC_PROVIDER ??
      saved?.providerId ??
      legacyDefault?.providerId ??
      "",
    modeId:
      environment.MUSIC_PLAYBACK_MODE ??
      saved?.modeId ??
      legacyDefault?.modeId ??
      "",
  });
  return Object.freeze({
    active: selected.providerId && selected.modeId ? selected : null,
    selected,
    locks,
    sources: Object.freeze({
      providerId: locks.providerId
        ? "environment"
        : saved
          ? "saved"
          : legacyDefault
            ? "default"
            : "unset",
      modeId: locks.modeId
        ? "environment"
        : saved
          ? "saved"
          : legacyDefault
            ? "default"
            : "unset",
    }),
    issue: musicConfigIssue(selected, registry),
  });
}
