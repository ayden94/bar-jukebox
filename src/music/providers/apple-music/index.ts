import type { ProviderDescriptor } from "../../contracts/index";

export const appleMusicDescriptor = {
  providerId: "apple-music",
  displayName: "Apple Music",
  modes: [
    {
      modeId: "applescript",
      location: "server",
      capabilities: {
        canPlayExactTrack: true,
        canPause: true,
        canResume: true,
        canStop: true,
        canRestart: true,
        canObserveEnd: true,
        canSeek: true,
      },
    },
  ],
} as const satisfies ProviderDescriptor;
