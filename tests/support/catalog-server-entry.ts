import { pathToFileURL } from "node:url";
import type { JukeboxRuntime } from "../../src/domains/providers";
import { youtubeMusicDescriptor } from "../../src/music/providers/youtube-music";
import { createYouTubeMusicServer } from "../../src/music/providers/youtube-music/server";

const entry = process.argv[2];
if (!entry) throw new Error("빌드한 서버 진입점이 필요해요");
const nativeSend = process.send?.bind(process);
// runtime 관측 구독 설치를 마친 후 부모에게 준비를 알려요.
let ready: unknown;
process.send = ((message: unknown) => {
  ready = message;
  return true;
}) as typeof process.send;
const nativeFetch = globalThis.fetch;
const artworkRequests: string[] = [];
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://i.ytimg.com/")) {
      artworkRequests.push(url);
      if (url.includes("redirect"))
        return new Response(null, {
          status: 302,
          headers: { Location: "https://untrusted.invalid/cover" },
        });
      return new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
          "base64",
        ),
        { headers: { "Content-Type": "image/png" } },
      );
    }
    return nativeFetch(input, init);
  },
  nativeFetch,
);
const { startJukebox } = await import(pathToFileURL(entry).href);
// 제품의 선택 가능 목록과 별개로 내부 카탈로그 계약을 검증하는 QA 전용 주입이에요.
let runtime: JukeboxRuntime;
const provider = await createYouTubeMusicServer(
  {
    transport: {
      search: (...args) => runtime.catalogBridge.search(...args),
      lookup: (...args) => runtime.catalogBridge.lookup(...args),
    },
  },
  new AbortController().signal,
);
if (!provider.ok) throw new Error(provider.error.code);
const running: { app: { close(): Promise<void> }; runtime: JukeboxRuntime } =
  await startJukebox({
    playbackDisabled: false,
    music: { descriptor: youtubeMusicDescriptor, provider: provider.value },
  });
const app = running.app;
runtime = running.runtime;
process.send = nativeSend;
const operations = new Map<string, AbortController>();
const results = new Map<string, unknown>();
let subscriptions = 0;
let notifications = 0;
const subscriptionWaiters = new Set<() => void>();
const originalSubscribe = runtime.catalogBridge.subscribe.bind(
  runtime.catalogBridge,
);
runtime.catalogBridge.subscribe = (listener) => {
  subscriptions++;
  let closed = false;
  const off = originalSubscribe(() => {
    notifications++;
    listener();
  });
  return () => {
    if (closed) return;
    closed = true;
    subscriptions--;
    off();
    if (subscriptions === 0)
      for (const resolve of [...subscriptionWaiters]) resolve();
  };
};
process.on("message", async (raw: unknown) => {
  const message = raw as {
    id: string;
    action: string;
    count?: number;
    key?: string;
  };
  try {
    let value: unknown;
    if (message.action === "advance-clock") {
      globalThis.catalogQAClockOffset =
        (globalThis.catalogQAClockOffset ?? 0) + 300000;
      value = true;
    } else if (message.action === "unsubscribed") {
      if (subscriptions !== 0)
        await new Promise<void>((resolve) => {
          const done = () => {
            subscriptionWaiters.delete(done);
            resolve();
          };
          subscriptionWaiters.add(done);
        });
      value = subscriptions;
    } else if (message.action === "start" || message.action === "lookup") {
      const keys: string[] = [];
      for (let index = 0; index < (message.count ?? 1); index++) {
        const key = crypto.randomUUID();
        const abort = new AbortController();
        operations.set(key, abort);
        keys.push(key);
        const pending =
          message.action === "lookup"
            ? runtime.catalogBridge.lookup(
                { providerId: "youtube-music", trackId: "fixture0001" },
                abort.signal,
              )
            : runtime.catalogBridge.search(`hold-${key}`, null, abort.signal);
        void pending
          .then(
            (result) => results.set(key, result),
            (error: unknown) =>
              results.set(key, {
                cancelled: error instanceof Error ? error.name : String(error),
              }),
          )
          .finally(() => operations.delete(key));
      }
      value = keys;
    } else if (message.action === "abort") {
      operations.get(message.key ?? "")?.abort();
      value = true;
    } else if (message.action === "abort-all") {
      for (const operation of operations.values()) operation.abort();
      value = true;
    } else if (message.action === "state") {
      const owner = (await runtime.playbackService.snapshot()).owner;
      value = {
        requests: runtime.catalogBridge.requests(
          owner?.executorSessionId ?? "",
        ),
        results: Object.fromEntries(results),
        subscriptions,
        notifications,
        artworkRequests,
      };
    } else if (message.action === "dispose") {
      await runtime.dispose();
      value = { subscriptions, pending: operations.size };
    } else throw new Error("알 수 없는 QA 동작이에요");
    nativeSend?.({ type: "catalog-qa", id: message.id, value });
  } catch (error) {
    nativeSend?.({ type: "catalog-qa", id: message.id, error: String(error) });
  }
});
process.on("SIGTERM", () => {
  void (async () => {
    for (const operation of operations.values()) operation.abort();
    await runtime.dispose();
    await app.close();
    process.exit(0);
  })();
});
nativeSend?.(ready);
