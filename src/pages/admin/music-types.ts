import type {
  AuthState,
  ConnectedTarget,
  ProviderDescriptor,
} from "../../music/contracts";

export type MusicConfigView = {
  readonly providerId: string;
  readonly modeId: string;
};

export type MusicSnapshot = {
  readonly active: MusicConfigView | null;
  readonly activeSources: MusicConfigSources;
  readonly nextBoot: {
    readonly config: MusicConfigView;
    readonly sources: MusicConfigSources;
    readonly issue: string | null;
  };
  readonly locks: { readonly providerId: boolean; readonly modeId: boolean };
  readonly restartRequired: boolean;
  readonly providers: readonly {
    readonly descriptor: ProviderDescriptor;
    readonly modes: readonly {
      readonly modeId: string;
      readonly displayName: string;
      readonly available: boolean;
      readonly unavailableReason: string | null;
    }[];
  }[];
  readonly readiness:
    | "setup-required"
    | "disabled"
    | "ready"
    | "connecting"
    | "auth-required"
    | "unavailable"
    | "conflict";
  readonly reason: string | null;
  readonly auth: AuthState | null;
  readonly connectedTarget: ConnectedTarget | null;
  readonly owner: {
    readonly executorSessionId: string;
    readonly location: "server" | "browser";
    readonly expiresAt: number | null;
  } | null;
  readonly actions: {
    readonly connectAuth: boolean;
    readonly disconnectAuth: boolean;
    readonly listTargets: boolean;
    readonly connectTarget: boolean;
    readonly disconnectTarget: boolean;
  };
};

type MusicConfigSources = {
  readonly providerId: "environment" | "saved" | "default" | "unset";
  readonly modeId: "environment" | "saved" | "default" | "unset";
};
