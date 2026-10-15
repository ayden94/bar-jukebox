import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServerProcess } from "./server-process";

type IsolatedServerOptions = {
  readonly intercept?: (
    request: Request,
  ) => Response | undefined | Promise<Response | undefined>;
};

export async function createIsolatedServer(
  options: IsolatedServerOptions = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "jukebox-browser-"));
  const token = randomBytes(32).toString("hex");
  try {
    const server = await startServerProcess({
      command: [
        process.execPath,
        "--preload",
        resolve("tests/support/itunes-preload.ts"),
        resolve("dist/server/main.js"),
      ],
      env: {
        ...process.env,
        PORT: "0",
        BASE_URL: "http://127.0.0.1",
        DATABASE_URL: `file:${join(directory, "browser.sqlite")}`,
        ADMIN_TOKEN: token,
        DEVICE_COOKIE_SECRET: randomBytes(32).toString("hex"),
        PLAYBACK_DISABLED: "1",
      },
    });
    const streams = new Set<AbortController>();
    let bfcacheFixture = false;
    let onPageShow: ((persisted: boolean) => void) | undefined;
    const proxy = Bun.serve({
      port: 0,
      idleTimeout: 255,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/__qa/pageshow") {
          onPageShow?.(url.searchParams.get("persisted") === "true");
          return new Response(null, { status: 204 });
        }
        const intercepted = await options.intercept?.(request);
        if (intercepted) return intercepted;
        const target = new URL(url.pathname + url.search, server.url);
        if (url.pathname !== "/api/events") {
          const response = await fetch(new Request(target, request), {
            redirect: "manual",
          });
          if (
            bfcacheFixture &&
            response.headers.get("Content-Type")?.includes("text/html")
          ) {
            response.headers.set("Cache-Control", "private, max-age=0");
          }
          return response;
        }
        const abort = new AbortController();
        streams.add(abort);
        const response = await fetch(new Request(target, request), {
          signal: AbortSignal.any([request.signal, abort.signal]),
        });
        const source = response.body;
        if (!source) throw new Error("SSE 응답 본문이 없어요");
        let cancelled = false;
        return new Response(
          new ReadableStream({
            async start(controller) {
              try {
                for await (const chunk of source) {
                  controller.enqueue(chunk);
                }
                controller.close();
              } catch (error) {
                if (!cancelled) {
                  if (abort.signal.aborted) {
                    controller.close();
                  } else controller.error(error);
                }
              } finally {
                streams.delete(abort);
              }
            },
            cancel() {
              cancelled = true;
              abort.abort();
            },
          }),
          { headers: response.headers, status: response.status },
        );
      },
    });
    return {
      url: `http://127.0.0.1:${proxy.port}`,
      token,
      nextPageShow() {
        const signal = Promise.withResolvers<boolean>();
        const timeout = setTimeout(
          () => signal.reject(new Error("pageshow 시간 초과")),
          10000,
        );
        onPageShow = signal.resolve;
        return signal.promise.finally(() => {
          clearTimeout(timeout);
          onPageShow = undefined;
        });
      },
      enableBfcacheFixture() {
        bfcacheFixture = true;
      },
      disconnectEvents() {
        for (const stream of streams) stream.abort();
      },
      async [Symbol.asyncDispose]() {
        for (const stream of streams) stream.abort();
        await proxy.stop(true);
        await server.stop();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
