import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import type { BrowserCatalogRequest } from "../../src/domains/music/browser-catalog-protocol";
import { startServerProcess } from "./server-process";

export type CatalogQAState = {
  requests: BrowserCatalogRequest[];
  results: Record<string, unknown>;
  subscriptions: number;
  notifications: number;
  artworkRequests: string[];
};

export async function startCatalogQA() {
  const directory = await mkdtemp(join(tmpdir(), "catalog-qa-"));
  let server: Awaited<ReturnType<typeof startServerProcess>> | undefined;
  const replies = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<unknown>>
  >();
  try {
    await symlink(
      resolve("node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    await build({
      configFile: resolve("vite.client.config.ts"),
      plugins: [
        {
          name: "qa-catalog-registration",
          enforce: "pre",
          resolveId(source, importer) {
            if (
              source === "./music-registry" &&
              importer?.endsWith("/src/pages/admin/browser-music-host.tsx")
            )
              return resolve("tests/support/browser-catalog-fixture.ts");
          },
        },
      ],
      build: { outDir: join(directory, "dist/client") },
    });
    await build({
      configFile: resolve("vite.server.config.ts"),
      plugins: [
        {
          name: "qa-catalog-clock",
          enforce: "pre",
          resolveId(source, importer) {
            if (
              source.endsWith("/browser-catalog-bridge") &&
              !importer?.endsWith("/tests/support/catalog-clock.ts")
            )
              return resolve("tests/support/catalog-clock.ts");
          },
        },
      ],
      build: { outDir: join(directory, "dist/server") },
    });
    server = await startServerProcess({
      command: [
        process.execPath,
        resolve("tests/support/catalog-server-entry.ts"),
        join(directory, "dist/server/main.js"),
      ],
      env: {
        ...process.env,
        PORT: "0",
        BASE_URL: "http://127.0.0.1",
        DATABASE_URL: `file:${join(directory, "qa.sqlite")}`,
        ADMIN_TOKEN: "qa-local-only",
        DEVICE_COOKIE_SECRET: "qa-local-only",
        MUSIC_PROVIDER: "youtube-music",
        MUSIC_PLAYBACK_MODE: "browser-companion",
        PLAYBACK_DISABLED: "0",
      },
      onMessage(raw) {
        const message = raw as {
          type?: string;
          id: string;
          value: unknown;
          error?: string;
        };
        if (message.type !== "catalog-qa") return;
        const pending = replies.get(message.id);
        if (message.error) pending?.reject(new Error(message.error));
        else pending?.resolve(message.value);
      },
    });
    const url = server.url;
    async function control(
      action: string,
      fields: { count?: number; key?: string } = {},
    ): Promise<unknown> {
      const id = crypto.randomUUID();
      const result = Promise.withResolvers<unknown>();
      replies.set(id, result);
      const timer = setTimeout(
        () => result.reject(new Error(`QA ${action} 응답 시간 초과`)),
        10000,
      );
      server!.send({ id, action, ...fields });
      try {
        return await result.promise;
      } finally {
        clearTimeout(timer);
        replies.delete(id);
      }
    }
    return {
      url,
      pid: server.pid,
      directory,
      control,
      state: async () => (await control("state")) as CatalogQAState,
      async api(path: string, body?: unknown) {
        const response = await fetch(`${url}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "x-admin-token": "qa-local-only",
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        return { status: response.status, body: await response.json() };
      },
      async close() {
        await server?.stop();
        await rm(directory, { recursive: true, force: true });
        assert.equal(
          await Bun.file(join(directory, "qa.sqlite")).exists(),
          false,
        );
        assert.equal(replies.size, 0);
      },
    };
  } catch (error) {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
