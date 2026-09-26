import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { BunHttpApplicationAdapter } from "@fluojs/platform-bun";
import { FluoFactory } from "@fluojs/runtime";

import { createJukeboxModule } from "./app";
import {
  playbackService,
  queueRepository,
  queueService,
  settingsRepository,
  settingsService,
} from "./domains/providers";
import { initDatabase } from "./infra/db";

// 재시작 시 SQLite에서 상태 복원 (큐/히스토리/재생중/설정)
await initDatabase();
const storedNowPlaying = await queueRepository.loadNowPlaying();
queueService.hydrate({
  nowPlaying: storedNowPlaying
    ? {
        song: storedNowPlaying.song,
        startedAt: storedNowPlaying.startedAt,
        status: "playing",
        positionSec: 0,
        durationSec: null,
      }
    : null,
  queue: await queueRepository.loadQueue(),
  history: await queueRepository.loadHistory(),
});
settingsService.hydrate(await settingsRepository.load());

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

const manifest: unknown = await loadClientManifest();

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

const AppModule = createJukeboxModule({
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
const app = await FluoFactory.create(AppModule, { adapter });

await app.listen();

console.log(`JUKEBOX_READY ${adapter.getServer()?.port}`);
if (process.env.PLAYBACK_DISABLED !== "1") {
  playbackService.start().catch((e) => {
    console.error("playback loop crashed:", e);
    process.exitCode = 1;
    void app.close();
  });
}
