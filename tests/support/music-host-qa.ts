import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { startServerProcess } from "./server-process";

export const hostProbe = `(() => {
  const stats = window.__hostQA = { provider: [], requests: [], failures: [], publicState: null };
  const notify = () => window.dispatchEvent(new Event("qa-lifecycle"));
  const NativeSource = window.EventSource;
  window.EventSource = class extends NativeSource {
    constructor(...args) {
      super(...args);
      this.addEventListener("state", event => { stats.publicState = JSON.parse(event.data); notify(); });
    }
  };
  window.addEventListener("qa-provider", e => { stats.provider.push(e.detail); notify(); });
  window.addEventListener("error", e => { stats.failures.push(e.message); notify(); });
  window.addEventListener("unhandledrejection", e => { stats.failures.push(String(e.reason)); notify(); });
  const original = window.fetch.bind(window);
  window.fetch = async (path, init) => {
    const response = await original(path, init);
    const url = new URL(typeof path === "string" ? path : path.url, location.href);
    if (url.pathname.startsWith("/api/admin/playback/")) {
      stats.requests.push({ path: url.pathname, status: response.status,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      notify();
    }
    return response;
  };
})();`;

// allow: SIZE_OK — 빌드·서버·프록시·SSE 자원의 생성과 정리를 한 fixture 수명에서 보장해요.
// 제품과 같은 production SSR/라우트/스타일 빌드에 공급자 모듈 하나만 QA 경계로 치환해요.
export async function startMusicHostQA(
  options: {
    readonly musicKit?: "fixture" | "production";
    readonly token?: "valid-fixture" | "invalid" | "expired" | "missing";
    readonly boot?: "unlocked" | { providerId: string; modeId: string };
    readonly disabled?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "music-host-"));
  let server: Awaited<ReturnType<typeof startServerProcess>> | undefined;
  let proxy: ReturnType<typeof Bun.serve> | undefined;
  const streams = new Map<string, AbortController>();
  const requests: { path: string; status: number; body: unknown }[] = [];
  let failRelease = false;
  let failSnapshot: "music" | "playback" | null = null;
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
          name: "qa-browser-provider",
          enforce: "pre",
          resolveId(source, importer) {
            if (
              !options.musicKit &&
              source === "./music-registry" &&
              importer?.endsWith("/src/pages/admin/browser-music-host.tsx")
            )
              return resolve("tests/support/music-host-registry.ts");
            if (
              options.musicKit === "fixture" &&
              source === "./sdk-loader" &&
              importer?.endsWith(
                "/src/music/providers/apple-music/browser/index.ts",
              )
            )
              return resolve("tests/support/musickit-sdk-loader.ts");
          },
        },
      ],
      build: { outDir: join(directory, "dist/client") },
    });
    await build({
      configFile: resolve("vite.server.config.ts"),
      build: { outDir: join(directory, "dist/server") },
    });
    const start = () =>
      startServerProcess({
        command: options.musicKit
          ? [
              process.execPath,
              "--preload",
              resolve("tests/support/itunes-preload.ts"),
              join(directory, "dist/server/main.js"),
            ]
          : [
              process.execPath,
              resolve("tests/support/music-host-server-entry.ts"),
              join(directory, "dist/server/main.js"),
            ],
        env: {
          ...process.env,
          PORT: "0",
          BASE_URL: "http://127.0.0.1",
          DATABASE_URL: `file:${join(directory, "qa.sqlite")}`,
          ADMIN_TOKEN: "qa-local-only",
          DEVICE_COOKIE_SECRET: "qa-local-only",
          ...(options.musicKit
            ? {
                MUSIC_PROVIDER:
                  options.boot === "unlocked"
                    ? undefined
                    : (options.boot?.providerId ?? "apple-music"),
                MUSIC_PLAYBACK_MODE:
                  options.boot === "unlocked"
                    ? undefined
                    : (options.boot?.modeId ?? "musickit"),
                PLAYBACK_DISABLED: options.disabled ? "1" : "0",
                MUSICKIT_DEVELOPER_TOKEN:
                  options.token === "invalid"
                    ? "invalid"
                    : options.token === "missing" ||
                        options.musicKit === "production"
                      ? ""
                      : [
                          Buffer.from(
                            JSON.stringify({ alg: "ES256", kid: "QA" }),
                          ).toString("base64url"),
                          Buffer.from(
                            JSON.stringify({
                              iss: "QA",
                              iat: 1,
                              exp: options.token === "expired" ? 2 : 4102444800,
                            }),
                          ).toString("base64url"),
                          Buffer.alloc(64).toString("base64url"),
                        ].join("."),
              }
            : {}),
        },
      });
    server = await start();
    let upstream = server.url;
    proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 255,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/__qa/probe.js")
          return new Response(hostProbe, {
            headers: { "Content-Type": "text/javascript" },
          });
        const body =
          request.method === "POST" ? await request.clone().json() : null;
        if (
          (failSnapshot === "music" && url.pathname === "/api/admin/music") ||
          (failSnapshot === "playback" &&
            url.pathname === "/api/admin/playback/snapshot")
        )
          return Response.json(
            { error: { message: "QA 상태 조회 실패" } },
            { status: 503 },
          );
        if (url.pathname.endsWith("/release") && failRelease) {
          requests.push({ path: url.pathname, body, status: 503 });
          return Response.json({ ok: false }, { status: 503 });
        }
        const target = new URL(url.pathname + url.search, upstream);
        if (url.pathname === "/api/admin/playback/events") {
          const id = url.searchParams.get("executorSessionId");
          assert(id);
          const abort = new AbortController();
          streams.set(id, abort);
          const response = await fetch(new Request(target, request), {
            signal: AbortSignal.any([request.signal, abort.signal]),
          });
          assert(response.body);
          let cancelled = false;
          return new Response(
            new ReadableStream({
              async start(controller) {
                try {
                  for await (const chunk of response.body!)
                    controller.enqueue(chunk);
                  if (!cancelled) controller.close();
                } catch (error) {
                  if (!cancelled) {
                    if (abort.signal.aborted) controller.close();
                    else controller.error(error);
                  }
                } finally {
                  streams.delete(id);
                }
              },
              cancel() {
                cancelled = true;
                abort.abort();
              },
            }),
            { status: response.status, headers: response.headers },
          );
        }
        const response = await fetch(new Request(target, request), {
          redirect: "manual",
        });
        if (url.pathname.startsWith("/api/admin/playback/"))
          requests.push({ path: url.pathname, body, status: response.status });
        if (response.headers.get("Content-Type")?.includes("text/html")) {
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          return new Response(
            (await response.text()).replace(
              "<body>",
              '<body><script src="/__qa/probe.js"></script>',
            ),
            { status: response.status, headers },
          );
        }
        return response;
      },
    });
    const url = `http://127.0.0.1:${proxy.port}`;
    return {
      url,
      directory,
      requests,
      streams,
      setFailRelease(value: boolean) {
        failRelease = value;
      },
      setFailSnapshot(value: "music" | "playback" | null) {
        failSnapshot = value;
      },
      async restart() {
        for (const stream of streams.values()) stream.abort();
        await server?.stop();
        server = await start();
        upstream = server.url;
      },
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
        for (const stream of streams.values()) stream.abort();
        await proxy?.stop(true);
        await server?.stop();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await proxy?.stop(true);
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
