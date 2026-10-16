import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { BunHttpApplicationAdapter } from "@fluojs/platform-bun";
import { FluoFactory } from "@fluojs/runtime";

import { createJukeboxModule } from "./app";
import { createJukeboxRuntime } from "./domains/providers";
import { createDatabase, initDatabase } from "./infra/db";
import { themeScript } from "./pages/theme";

const connection = createDatabase(
  process.env.DATABASE_URL ?? "file:jukebox.sqlite",
);
await initDatabase(connection);
const runtime = await createJukeboxRuntime(
  { playbackDisabled: process.env.PLAYBACK_DISABLED === "1" },
  connection,
);

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
const app = await FluoFactory.create(AppModule, {
  adapter,
  securityHeaders: {
    contentSecurityPolicy: `default-src 'self'; script-src 'self' 'sha256-${themeHash}'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`,
  },
});

await app.listen();

if (process.send) {
  process.send({ type: "jukebox-ready", port: adapter.getServer()?.port });
}

if (process.env.PLAYBACK_DISABLED !== "1") {
  runtime.playbackService.start().catch((e) => {
    console.error("playback loop crashed:", e);
    process.exitCode = 1;
    void app.close();
  });
}
