import { readFile } from "node:fs/promises";
import { BunHttpApplicationAdapter } from "@fluojs/platform-bun";
import { FluoFactory } from "@fluojs/runtime";

import { createJukeboxModule } from "./app";
import { onChange } from "./jukebox/bus";
import * as db from "./jukebox/db";
import { startPlaybackLoop } from "./jukebox/playback";
import { state } from "./jukebox/state";

// 재시작 시 SQLite에서 상태 복원 (큐/히스토리/재생중/설정)
state.hydrate(db.loadState());

// 상태 변경(mutate)을 SQLite에 저장. SSE 브로드캐스트는 events.controller가 수행.
onChange((event) => {
  if (event === "mutate") db.saveSnapshot(state.snapshot());
});

const manifest: unknown = JSON.parse(
  await readFile(
    new URL("../client/.vite/manifest.json", import.meta.url),
    "utf8",
  ),
);
const AppModule = createJukeboxModule({
  clientDirectory: new URL("../client/", import.meta.url),
  manifest,
});

const PORT = Number(process.env.PORT ?? 5173);

const app = await FluoFactory.create(AppModule, {
  adapter: BunHttpApplicationAdapter.create({ port: PORT, idleTimeout: 255 }),
});

await app.listen();
console.log(`jukebox (fluo) listening on http://localhost:${PORT}`);

startPlaybackLoop().catch((e) => console.error("playback loop crashed:", e));
