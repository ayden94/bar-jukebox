import { pathToFileURL } from "node:url";
import { createContrastingProvider } from "../../src/music/testing";

const entry = process.argv[2];
if (!entry) throw new Error("QA production server entry가 필요해요.");
const fixture = createContrastingProvider({ location: "browser" });
const { startJukebox } = await import(pathToFileURL(entry).href);
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
