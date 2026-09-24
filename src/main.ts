import { BunHttpApplicationAdapter } from "@fluojs/platform-bun";
import { FluoFactory } from "@fluojs/runtime";

import { AppModule } from "./app.module";
import * as db from "./jukebox/db";
import { startPlaybackLoop } from "./jukebox/playback";
import { state } from "./jukebox/state";

// 재시작 시 SQLite에서 상태 복원 (큐/히스토리/재생중/설정)
// state 변경 → SQLite 저장 + SSE 브로드캐스트는 P2 events.controller에서 연결된다
state.hydrate(db.loadState());

const PORT = Number(process.env.PORT ?? 5173);

const app = await FluoFactory.create(AppModule, {
  adapter: BunHttpApplicationAdapter.create({ port: PORT, idleTimeout: 255 }),
});

await app.listen();
console.log(`jukebox (fluo) listening on http://localhost:${PORT}`);

startPlaybackLoop().catch((e) => console.error("playback loop crashed:", e));
