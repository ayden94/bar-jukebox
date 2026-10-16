import type { MusicRuntimeState } from "./music.service";
import type { MusicConfig, MusicRegistration } from "./music-config";

export const firstConfig: MusicConfig = {
  providerId: "fixture",
  modeId: "local",
};
export const secondConfig: MusicConfig = {
  providerId: "another",
  modeId: "remote",
};

export const registry: readonly MusicRegistration[] = [
  firstConfig,
  secondConfig,
].map((config) => ({
  descriptor: {
    providerId: config.providerId,
    displayName: config.providerId,
    modes: [
      {
        modeId: config.modeId,
        location: "server",
        capabilities: {
          canPlayExactTrack: true,
          canPause: true,
          canResume: true,
          canStop: true,
          canRestart: true,
          canObserveEnd: true,
          canSeek: false,
        },
      },
    ],
  },
  modes: [
    {
      modeId: config.modeId,
      displayName: config.modeId,
      available: true,
      unavailableReason: null,
    },
  ],
}));

export const readyState: MusicRuntimeState = {
  readiness: "ready",
  reason: null,
  auth: { status: "authorized", authorization: "service", action: null },
  connectedTarget: null,
  owner: {
    executorSessionId: "server-session",
    location: "server",
    expiresAt: null,
  },
};
