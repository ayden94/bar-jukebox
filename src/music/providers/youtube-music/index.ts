import type { ProviderDescriptor } from "../../contracts";

export const youtubeMusicDescriptor = {
  providerId: "youtube-music",
  displayName: "YouTube Music",
  modes: [
    {
      modeId: "browser-companion",
      location: "browser",
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
} as const satisfies ProviderDescriptor;
