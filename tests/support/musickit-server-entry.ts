import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appleMusicDescriptor } from "../../src/music/providers/apple-music";
import {
  createAppleMusicKitServer,
  createAppleMusicServer,
} from "../../src/music/providers/apple-music/server";

// 실제 provider와 빌드된 HTTP 앱을 주입해요. registry 통합 전용 QA 진입점이에요.
const wrongMode = process.env.TASK3_MODE === "applescript";
const developerToken = process.env.MUSICKIT_DEVELOPER_TOKEN;
const created = wrongMode
  ? await createAppleMusicServer(
      { disabled: true },
      new AbortController().signal,
    )
  : await createAppleMusicKitServer(
      { developerToken },
      new AbortController().signal,
    );
if (!created.ok) throw new Error(created.error.code);
const descriptor = {
  ...appleMusicDescriptor,
  modes: [
    ...appleMusicDescriptor.modes,
    {
      modeId: "musickit",
      location: "browser" as const,
      capabilities: appleMusicDescriptor.modes[0].capabilities,
    },
  ],
};
const { startJukebox } = await import(
  pathToFileURL(resolve("dist/server/main.js")).href
);
const running = await startJukebox({
  playbackDisabled: false,
  musickitDeveloperToken: developerToken,
  music: { descriptor, provider: created.value },
});
process.once("SIGTERM", () => {
  void running.app.close().then(() => process.exit(0));
});
