import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { BunHttpApplicationAdapter } from "@fluojs/platform-bun";
import { FluoFactory } from "@fluojs/runtime";

import { createJukeboxModule } from "./app";
import { onChange } from "./jukebox/bus";
import * as db from "./jukebox/db";
import { startPlaybackLoop } from "./jukebox/playback";
import { state } from "./jukebox/state";

// 재시작 시 SQLite에서 상태 복원 (큐/히스토리/재생중/설정)
await db.initDatabase();
state.hydrate(await db.loadState());

// 상태 변경(mutate)을 SQLite에 저장. SSE 브로드캐스트는 events.controller가 수행.
onChange((event) => {
  if (event === "mutate") {
    void db
      .saveSnapshot(state.snapshot())
      .catch((e) => console.error("snapshot save failed:", e));
  }
});

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

const app = await FluoFactory.create(AppModule, {
  adapter: BunHttpApplicationAdapter.create({ port: PORT, idleTimeout: 255 }),
});

await app.listen();

startPlaybackLoop().catch((e) => console.error("playback loop crashed:", e));
