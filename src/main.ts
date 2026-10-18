import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { BunHttpApplicationAdapter } from "@fluojs/platform-bun";
import { FluoFactory } from "@fluojs/runtime";

import { createJukeboxModule } from "./app";
import { createJukeboxRuntime, type RuntimeConfig } from "./domains/providers";
import { createDatabase, initDatabase } from "./infra/db";
import { themeScript } from "./pages/theme";

async function loadClientManifest(): Promise<unknown> {
  const candidates = [
    new URL("../client/.vite/manifest.json", import.meta.url),
    new URL("../dist/client/.vite/manifest.json", import.meta.url),
  ];
  for (const url of candidates) {
    try {
      return JSON.parse(await readFile(url, "utf8"));
    } catch {}
  }
  throw new Error(
    "client manifest not found — run the vite client build first",
  );
}

function resolveClientDirectory(): URL {
  for (const url of [
    new URL("../client/", import.meta.url),
    new URL("../dist/client/", import.meta.url),
  ]) {
    if (existsSync(url)) return url;
  }
  throw new Error(
    "client assets directory not found — run the vite client build first",
  );
}

export async function startJukebox(
  config: RuntimeConfig = {
    playbackDisabled: process.env.PLAYBACK_DISABLED === "1",
    musickitDeveloperToken: process.env.MUSICKIT_DEVELOPER_TOKEN,
    environment: {
      MUSIC_PROVIDER: process.env.MUSIC_PROVIDER,
      MUSIC_PLAYBACK_MODE: process.env.MUSIC_PLAYBACK_MODE,
    },
  },
) {
  const connection = createDatabase(
    process.env.DATABASE_URL ?? "file:jukebox.sqlite",
  );
  await initDatabase(connection);
  const [runtime, manifest] = await Promise.all([
    createJukeboxRuntime(config, connection),
    loadClientManifest(),
  ]);
  const AppModule = createJukeboxModule({
    runtime,
    clientDirectory: resolveClientDirectory(),
    manifest,
  });

  const PORT = Number(process.env.PORT ?? 5173);

  if (!process.env.DEVICE_COOKIE_SECRET && !process.env.ADMIN_TOKEN) {
    throw new Error("DEVICE_COOKIE_SECRET 또는 ADMIN_TOKEN이 필요해요");
  }
  const adapter = BunHttpApplicationAdapter.create({
    port: PORT,
    idleTimeout: 255,
  });
  const themeHash = createHash("sha256").update(themeScript).digest("base64");
  // nextBoot 저장은 현재 문서의 권한을 바꾸지 않아요.
  const { active } = await runtime.musicService.getSnapshot();
  const musickit =
    active?.providerId === "apple-music" && active.modeId === "musickit";
  const musicScript = musickit ? " https://js-cdn.music.apple.com" : "";
  // SDK에서 확인한 API와 MediaSource만 허용해요. 실재생 CDN/DRM은 별도 검증해요.
  const musicResources = musickit
    ? "; connect-src 'self' https://api.music.apple.com https://play.itunes.apple.com https://play-edge.itunes.apple.com https://universal-activity-service.itunes.apple.com; media-src 'self' blob:; worker-src 'self'"
    : "";
  const app = await FluoFactory.create(AppModule, {
    adapter,
    securityHeaders: {
      contentSecurityPolicy: `default-src 'self'; script-src 'self' 'sha256-${themeHash}'${musicScript}; img-src 'self' data:; style-src 'self' 'unsafe-inline'${musicResources}`,
    },
  });

  await app.listen();

  if (process.send) {
    process.send({ type: "jukebox-ready", port: adapter.getServer()?.port });
  }

  if (!config.playbackDisabled) {
    runtime.playbackService.start().catch((e) => {
      console.error("playback loop crashed:", e);
      process.exitCode = 1;
      void app.close();
    });
  }
  return { app, runtime };
}

if (import.meta.main) await startJukebox();
