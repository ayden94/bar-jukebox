import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContrastingProvider } from "../../src/music/testing";

const fixture = createContrastingProvider({ location: "browser" });
const { startJukebox } = await import(
  pathToFileURL(resolve("dist/server/main.js")).href
);
await startJukebox({
  playbackDisabled: false,
  music: {
    descriptor: fixture.descriptor,
    provider: {
      ...fixture.provider,
      artwork: {
        fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
      },
    },
  },
});
