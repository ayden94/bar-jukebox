import { expect, test } from "bun:test";
import type { PlaybackOwner } from "../../domains/playback/protocol";
import type {
  BrowserMusicProvider,
  CatalogPort,
  MusicResult,
} from "../../music/contracts";
import { createAppleMusicBrowser } from "../../music/providers/apple-music/browser";
import { createContrastingProvider } from "../../music/testing";
import { BrowserMusicLifecycle } from "./browser-music-lifecycle";
import {
  loadBrowserMusicFactory,
  type SelectedBrowserFactory,
} from "./music-registry";

function fixture(
  options: { auth?: boolean; capabilities?: boolean; release?: boolean } = {},
) {
  const fixture = createContrastingProvider({
    location: "browser",
    capabilities: { canStop: options.capabilities ?? true },
  });
  const calls: string[] = [];
  let owner: PlaybackOwner | undefined;
  let channel: ReadableStreamDefaultController<Uint8Array> | null = null;
  const provider: BrowserMusicProvider = {
    identity: fixture.provider.identity,
    auth: {
      ...fixture.provider.auth,
      async connect(signal) {
        calls.push("auth");
        if (options.auth === false)
          return { ok: false, error: { code: "auth-required" } };
        return fixture.provider.auth.connect(signal);
      },
    },
    runtime: {
      ...fixture.runtime,
      connection: {
        ...fixture.runtime.connection,
        async connect(target, signal) {
          calls.push("connect");
          return fixture.runtime.connection.connect(target, signal);
        },
      },
    },
    async dispose() {
      calls.push("dispose");
      await fixture.provider.dispose();
    },
  };
  const loadFactory = async (): Promise<
    MusicResult<SelectedBrowserFactory>
  > => {
    calls.push("load");
    return { ok: true, value: async () => ({ ok: true, value: provider }) };
  };
  const fetcher = async (path: string, init: RequestInit = {}) => {
    if (path.endsWith("/owner")) {
      calls.push("claim");
      const body = JSON.parse(String(init.body));
      owner = { ...body, ownerEpoch: 1, released: false };
      return Response.json({ owner });
    }
    if (path.includes("/events?")) {
      calls.push("channel");
      return new Response(
        new ReadableStream({
          start(controller) {
            channel = controller;
            controller.enqueue(
              new TextEncoder().encode(
                `event: snapshot\ndata: ${JSON.stringify({ owner, messages: [] })}\n\n`,
              ),
            );
          },
          cancel() {
            calls.push("channel-closed");
          },
        }),
      );
    }
    if (path.endsWith("/release")) {
      calls.push("release");
      expect(calls).not.toContain("channel-closed");
      expect(calls).not.toContain("dispose");
      return Response.json(
        { ok: options.release ?? true },
        { status: options.release === false ? 409 : 201 },
      );
    }
    return Response.json({ ok: true });
  };
  const host = new BrowserMusicLifecycle({
    token: "test",
    api: fetcher,
    fetcher,
    loadFactory,
  });
  return {
    fixture,
    provider,
    host,
    calls,
    fetcher,
    loadFactory,
    sendCatalog() {
      if (!owner || !channel) throw new Error("연결된 실행기가 필요해요");
      channel.enqueue(
        new TextEncoder().encode(
          `event: snapshot\ndata: ${JSON.stringify({
            owner,
            ownerConnected: true,
            messages: [],
            commands: [],
            attempt: null,
            catalogRequests: [
              {
                requestId: crypto.randomUUID(),
                ownerEpoch: owner.ownerEpoch,
                executorSessionId: owner.executorSessionId,
                target: owner.connection.target,
                connectionGeneration: owner.connection.connectionGeneration,
                deadline: 1,
                remainingMs: 5000,
                operation: { type: "search", query: "곡", cursor: null },
              },
            ],
          })}\n\n`,
        ),
      );
    },
  };
}

test("브라우저 catalog 등록: 이전 unregister는 새 포트를 지우지 않고 수명 종료는 진행 작업을 취소해요", async () => {
  const f = fixture();
  const started = Promise.withResolvers<AbortSignal>();
  const calls: string[] = [];
  const port = (name: string): CatalogPort => ({
    search: (_query, _cursor, signal) => {
      calls.push(name);
      started.resolve(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
    lookup: async () => ({ ok: false, error: { code: "invalid-track" } }),
  });
  const host = new BrowserMusicLifecycle({
    token: "test",
    api: f.fetcher,
    fetcher: f.fetcher,
    loadFactory: async () => ({
      ok: true,
      value: async (options) => {
        const old = options.registerCatalog(port("old"));
        options.registerCatalog(port("new"));
        old();
        return { ok: true, value: f.provider };
      },
    }),
  });
  try {
    await host.connect(f.provider.identity, f.fixture.descriptor);
    f.sendCatalog();
    const signal = await started.promise;
    expect(calls).toEqual(["new"]);

    await host.disconnect();

    expect(signal.aborted).toBe(true);
    expect(host.getSnapshot().phase).toBe("disconnected");
  } finally {
    await host.close();
  }
});

test("브라우저 호스트: 명시적 연결 전 초기화하지 않고 인증·기기·권한 순서로 한 번만 연결해요", async () => {
  const f = fixture();
  expect(f.calls).toEqual([]);

  await Promise.all([
    f.host.connect(f.provider.identity, f.fixture.descriptor),
    f.host.connect(f.provider.identity, f.fixture.descriptor),
  ]);

  expect(f.calls.slice(0, 5)).toEqual([
    "load",
    "auth",
    "connect",
    "claim",
    "channel",
  ]);
  expect(f.host.getSnapshot().phase).toBe("connected");
  await f.host.close();
  expect(f.calls.indexOf("release")).toBeLessThan(
    f.calls.indexOf("channel-closed"),
  );
  expect(f.calls.indexOf("channel-closed")).toBeLessThan(
    f.calls.indexOf("dispose"),
  );
  expect(f.fixture.controls.subscriberCount).toBe(0);
});

for (const options of [{ auth: false }, { capabilities: false }]) {
  test(`브라우저 호스트: 준비 실패 ${JSON.stringify(options)}는 owner를 요청하지 않아요`, async () => {
    const f = fixture(options);

    await f.host.connect(f.provider.identity, f.fixture.descriptor);

    expect(f.calls).not.toContain("claim");
    expect(f.calls).toContain("dispose");
    expect(f.host.getSnapshot().phase).toBe("unavailable");
    await f.host.close();
  });
}

test("브라우저 호스트: 정지 해제 실패는 unknown을 보존하고 로컬 자원만 정리해요", async () => {
  const f = fixture({ release: false });
  await f.host.connect(f.provider.identity, f.fixture.descriptor);

  await f.host.disconnect();

  expect(f.host.getSnapshot().phase).toBe("unknown");
  expect(f.calls.filter((call) => call === "release")).toHaveLength(1);
  expect(f.calls).toContain("dispose");
  expect(f.fixture.controls.subscriberCount).toBe(0);
});

test("브라우저 호스트: 초기화 취소 뒤 늦은 provider는 정리하고 인증과 owner를 시작하지 않아요", async () => {
  const f = fixture();
  const creating = Promise.withResolvers<void>();
  const created = Promise.withResolvers<MusicResult<BrowserMusicProvider>>();
  const host = new BrowserMusicLifecycle({
    token: "test",
    api: f.fetcher,
    fetcher: f.fetcher,
    loadFactory: async () => ({
      ok: true,
      value: async () => {
        creating.resolve();
        return created.promise;
      },
    }),
  });
  const connect = host.connect(f.provider.identity, f.fixture.descriptor);
  await creating.promise;

  const close = host.close();
  created.resolve({ ok: true, value: f.provider });
  await Promise.all([connect, close]);

  expect(f.calls).toEqual(["dispose"]);
  expect(f.fixture.controls.subscriberCount).toBe(0);
});

test("브라우저 호스트: 연결 해제 뒤 다른 부팅 identity로 바꾸지 않아요", async () => {
  const f = fixture();
  await f.host.connect(f.provider.identity, f.fixture.descriptor);
  await f.host.disconnect();
  const before = [...f.calls];

  await f.host.connect(
    { ...f.provider.identity, modeId: "other" },
    f.fixture.descriptor,
  );

  expect(f.calls).toEqual(before);
  expect(f.host.getSnapshot().phase).toBe("unavailable");
});

test("내부 MusicKit factory: 토큰 조회 실패는 준비 성공으로 바꾸지 않아요", async () => {
  expect(
    await createAppleMusicBrowser(
      {
        api: async () => Response.json({}, { status: 503 }),
      },
      new AbortController().signal,
    ),
  ).toEqual({
    ok: false,
    error: { code: "configuration" },
  });
});

test("브라우저 registry: 로컬 미리보기는 브라우저 factory를 직접 활성화하지 않아요", async () => {
  for (const selected of [
    { providerId: "apple-music", modeId: "musickit" },
    { providerId: "youtube-music", modeId: "browser-companion" },
    { providerId: "apple-music", modeId: "applescript" },
  ]) {
    expect(
      await loadBrowserMusicFactory(selected, new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "unsupported" } });
  }
});

test("브라우저 호스트: 페이지 복원은 자동 claim 없이 정리 이후 명시적 연결만 허용해요", async () => {
  const first = fixture();
  const second = fixture();
  let loads = 0;
  const host = new BrowserMusicLifecycle({
    token: "test",
    api: first.fetcher,
    fetcher: first.fetcher,
    loadFactory: () =>
      loads++ === 0 ? first.loadFactory() : second.loadFactory(),
  });
  await host.connect(first.provider.identity, first.fixture.descriptor);
  await host.abandon();
  const claims = first.calls.filter((call) => call === "claim").length;

  await host.resume();

  expect(first.calls.filter((call) => call === "claim")).toHaveLength(claims);
  expect(first.calls).not.toContain("release");
  expect(host.getSnapshot().phase).toBe("unknown");
  await host.connect(second.provider.identity, second.fixture.descriptor);
  expect(loads).toBe(2);
  expect(host.getSnapshot().phase).toBe("connected");
  await host.close();
});
