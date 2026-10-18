import type {
  AuthState,
  ConnectedTarget,
  ConnectionTarget,
  MusicResult,
  PlaybackTarget,
} from "../../music/contracts";
import type { MusicRepository } from "./music.repository";
import {
  type MusicBootConfig,
  type MusicConfig,
  type MusicRegistration,
  musicConfigIssue,
  resolveMusicBootConfig,
} from "./music-config";

export type MusicReadiness =
  | "ready"
  | "connecting"
  | "auth-required"
  | "unavailable"
  | "conflict";

export type MusicRuntimeState = {
  readonly readiness: MusicReadiness;
  readonly reason: string | null;
  readonly auth: AuthState | null;
  readonly connectedTarget: ConnectedTarget | null;
  readonly owner: {
    readonly executorSessionId: string;
    readonly location: "server" | "browser";
    readonly expiresAt: number | null;
  } | null;
};

// 연결 변경은 조립에서 재생 조정 서비스에 위임해요. 저장소를 직접 바꾸지 않아요.
export type MusicRuntimeAccessors = {
  readonly getState: () => MusicRuntimeState | Promise<MusicRuntimeState>;
  readonly getDeveloperToken?: () => MusicResult<{ developerToken: string }>;
  readonly connectAuth?: (
    signal: AbortSignal,
  ) => Promise<MusicResult<AuthState>>;
  readonly disconnectAuth?: (
    signal: AbortSignal,
  ) => Promise<MusicResult<AuthState>>;
  readonly listTargets?: (
    signal: AbortSignal,
  ) => Promise<MusicResult<readonly ConnectionTarget[]>>;
  readonly connectTarget?: (
    target: PlaybackTarget,
    signal: AbortSignal,
  ) => Promise<MusicResult<void>>;
  readonly disconnectTarget?: (
    signal: AbortSignal,
  ) => Promise<MusicResult<void>>;
};

export class MusicConfigurationError extends Error {
  constructor(
    readonly code: "invalid-config" | "environment-locked",
    message: string,
  ) {
    super(message);
    this.name = "MusicConfigurationError";
  }
}

type MusicServiceOptions = {
  readonly boot: MusicBootConfig;
  readonly registry: readonly MusicRegistration[];
  readonly playbackDisabled: boolean;
  readonly runtime: MusicRuntimeAccessors;
};

export class MusicService {
  private readonly boot: MusicBootConfig;
  private nextBoot: MusicBootConfig;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: Pick<MusicRepository, "save">,
    private readonly options: MusicServiceOptions,
  ) {
    this.boot = structuredClone(options.boot);
    this.nextBoot = this.boot;
  }

  async getSnapshot() {
    const runtime = await this.options.runtime.getState();
    const blocked = this.boot.issue !== null || this.options.playbackDisabled;
    return structuredClone({
      active: this.boot.active,
      activeSources: this.boot.sources,
      nextBoot: {
        config: this.nextBoot.selected,
        sources: this.nextBoot.sources,
        issue: this.nextBoot.issue,
      },
      locks: this.boot.locks,
      restartRequired:
        this.boot.selected.providerId !== this.nextBoot.selected.providerId ||
        this.boot.selected.modeId !== this.nextBoot.selected.modeId,
      providers: this.options.registry,
      readiness: this.boot.issue
        ? ("setup-required" as const)
        : this.options.playbackDisabled
          ? ("disabled" as const)
          : runtime.readiness,
      reason:
        this.boot.issue ??
        (this.options.playbackDisabled
          ? "PLAYBACK_DISABLED=1로 외부 음악 앱과 플레이어 실행을 막고 있어요."
          : runtime.reason),
      auth: runtime.auth,
      connectedTarget: runtime.connectedTarget,
      owner: runtime.owner,
      actions: {
        connectAuth: !blocked && !!this.options.runtime.connectAuth,
        disconnectAuth: !blocked && !!this.options.runtime.disconnectAuth,
        listTargets: !blocked && !!this.options.runtime.listTargets,
        connectTarget: !blocked && !!this.options.runtime.connectTarget,
        disconnectTarget: !blocked && !!this.options.runtime.disconnectTarget,
      },
    });
  }

  async saveConfig(config: MusicConfig) {
    const proposed = { providerId: config.providerId, modeId: config.modeId };
    for (const field of ["providerId", "modeId"] as const) {
      if (
        this.boot.locks[field] &&
        proposed[field] !== this.boot.selected[field]
      ) {
        throw new MusicConfigurationError(
          "environment-locked",
          "환경 변수로 고정한 설정은 변경할 수 없어요. 서버 환경 변수를 수정하고 다시 시작해주세요.",
        );
      }
    }
    const issue = musicConfigIssue(proposed, this.options.registry);
    if (issue) throw new MusicConfigurationError("invalid-config", issue);
    const write = this.writeChain.then(async () => {
      await this.repository.save(proposed);
      this.nextBoot = resolveMusicBootConfig({
        environment: {
          MUSIC_PROVIDER: this.boot.locks.providerId
            ? this.boot.selected.providerId
            : undefined,
          MUSIC_PLAYBACK_MODE: this.boot.locks.modeId
            ? this.boot.selected.modeId
            : undefined,
        },
        saved: proposed,
        legacyDefault: null,
        registry: this.options.registry,
      });
    });
    this.writeChain = write.catch(() => {});
    await write;
    return await this.getSnapshot();
  }

  private actionBlocked(): boolean {
    return this.options.playbackDisabled || this.boot.issue !== null;
  }

  getDeveloperToken(): MusicResult<{ developerToken: string }> {
    if (
      this.actionBlocked() ||
      this.boot.active?.providerId !== "apple-music" ||
      this.boot.active.modeId !== "musickit" ||
      !this.options.runtime.getDeveloperToken
    ) {
      return { ok: false, error: { code: "unsupported" } };
    }
    return this.options.runtime.getDeveloperToken();
  }

  async connectAuth(signal: AbortSignal): Promise<MusicResult<AuthState>> {
    if (this.actionBlocked() || !this.options.runtime.connectAuth) {
      return { ok: false, error: { code: "unsupported" } };
    }
    return this.options.runtime.connectAuth(signal);
  }

  async disconnectAuth(signal: AbortSignal): Promise<MusicResult<AuthState>> {
    if (this.actionBlocked() || !this.options.runtime.disconnectAuth) {
      return { ok: false, error: { code: "unsupported" } };
    }
    return this.options.runtime.disconnectAuth(signal);
  }

  async listTargets(
    signal: AbortSignal,
  ): Promise<MusicResult<readonly ConnectionTarget[]>> {
    if (this.actionBlocked() || !this.options.runtime.listTargets) {
      return { ok: false, error: { code: "unsupported" } };
    }
    return this.options.runtime.listTargets(signal);
  }

  async connectTarget(
    target: PlaybackTarget,
    signal: AbortSignal,
  ): Promise<MusicResult<void>> {
    if (
      this.actionBlocked() ||
      !this.options.runtime.connectTarget ||
      target.providerId !== this.boot.active?.providerId ||
      target.modeId !== this.boot.active?.modeId
    ) {
      return { ok: false, error: { code: "unsupported" } };
    }
    return this.options.runtime.connectTarget(target, signal);
  }

  async disconnectTarget(signal: AbortSignal): Promise<MusicResult<void>> {
    if (this.actionBlocked() || !this.options.runtime.disconnectTarget) {
      return { ok: false, error: { code: "unsupported" } };
    }
    return this.options.runtime.disconnectTarget(signal);
  }
}
