import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appleMusicDescriptor } from "../../src/music/providers/apple-music";
import { createAppleMusicServer } from "../../src/music/providers/apple-music/server";

// 테스트가 실행 환경과 공급자 의존성을 명시적으로 주입해요. 준비 성공은 위조하지 않아요.
const created = await createAppleMusicServer(
  {
    disabled: true,
    platform: "darwin",
  },
  new AbortController().signal,
);
if (!created.ok) throw new Error(created.error.code);
const { startJukebox } = await import(
  pathToFileURL(resolve("dist/server/main.js")).href
);
await startJukebox({
  playbackDisabled: true,
  music: { descriptor: appleMusicDescriptor, provider: created.value },
});
