import { expect, test } from "bun:test";
import type { PlaybackOwner } from "../../domains/playback/protocol";
import type { PlaybackCommand } from "../../music/contracts";
import { createContrastingProvider } from "../../music/testing";
import { BrowserPlaybackExecutor } from "./playback-runtime";

async function fixture(channelStatus = 200) {
  const provider = createContrastingProvider({ location: "browser" });
  const signal = new AbortController().signal;
  const authorized = await provider.provider.auth.connect(signal);
  if (!authorized.ok) throw new Error("인증이 필요해요");
  const targets = await provider.runtime.connection.listTargets(signal);
  if (!targets.ok || !targets.value[0]) throw new Error("target이 필요해요");
  const connected = await provider.runtime.connection.connect(
    targets.value[0].ref,
    signal,
  );
  if (!connected.ok) throw new Error("연결이 필요해요");
  let owner: PlaybackOwner | null = null;
  let source: ReadableStreamDefaultController<Uint8Array> | null = null;
  const opened = Promise.withResolvers<void>();
  const receipt = Promise.withResolvers<void>();
  const observation = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const calls: PlaybackCommand[] = [];
  const paths: string[] = [];
  const fetcher = async (input: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("x-admin-token")).toBe("test-token");
    const url = new URL(input, "http://local.test");
    paths.push(url.pathname);
    if (url.pathname.endsWith("/owner")) {
      const body = JSON.parse(String(init.body));
      owner = {
        ownerEpoch: 1,
        executorSessionId: body.executorSessionId,
        connection: connected.value,
        heartbeatAt: 1,
        released: false,
        stopConfirmed: false,
      };
      return Response.json({ owner });
    }
    if (url.pathname.endsWith("/events")) {
      expect(url.searchParams.get("executorSessionId")).toBe(
        owner?.executorSessionId ?? "",
      );
      expect(url.searchParams.has("token")).toBe(false);
      if (channelStatus !== 200)
        return new Response(null, { status: channelStatus });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
            opened.resolve();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    if (url.pathname.endsWith("/receipt")) receipt.resolve();
    if (url.pathname.endsWith("/observation")) observation.resolve();
    return Response.json({ ok: true });
  };
  const executor = new BrowserPlaybackExecutor({
    token: "test-token",
    connection: connected.value,
    fetcher,
    playback: {
      ...provider.runtime.playback,
      execute: async (command, signal) => {
        calls.push(command);
        return provider.runtime.playback.execute(command, signal);
      },
    },
    onDisconnected: () => disconnected.resolve(),
  });
  await executor.start();
  return {
    executor,
    provider,
    calls,
    paths,
    opened,
    receipt,
    observation,
    disconnected,
    get owner() {
      if (!owner) throw new Error("owner가 필요해요");
      return owner;
    },
    send(messages: unknown[], override?: Partial<PlaybackOwner>) {
      if (!source) throw new Error("SSE 연결이 필요해요");
      source.enqueue(
        new TextEncoder().encode(
          `event: snapshot\ndata: ${JSON.stringify({
            owner: { ...owner, ...override },
            ownerConnected: true,
            attempt: null,
            commands: [],
            messages,
          })}\n\n`,
        ),
      );
    },
  };
}

test("같은 명령의 중복 snapshot은 한 번만 실행하고 헤더로 접수·관측을 보고해요", async () => {
  const f = await fixture();
  try {
    await f.opened.promise;
    const command: PlaybackCommand = {
      type: "play",
      trackRef: {
        providerId: f.owner.connection.target.providerId,
        trackId: "Mix:Aa/_?한글",
      },
      initialState: "playing",
      context: {
        commandId: "c",
        attemptId: "a",
        executorSessionId: f.executor.executorSessionId,
        target: f.owner.connection.target,
        connectionGeneration: f.owner.connection.connectionGeneration,
      },
    };
    f.send([
      { type: "command", command },
      { type: "command", command },
    ]);
    await f.receipt.promise;
    expect(f.calls).toEqual([command]);
    const sequence = f.provider.controls.pendingSequences().at(-1);
    if (sequence === undefined) throw new Error("관측이 필요해요");
    f.provider.controls.deliver(sequence);
    await f.observation.promise;
    expect(f.paths.indexOf("/api/admin/playback/receipt")).toBeLessThan(
      f.paths.indexOf("/api/admin/playback/observation"),
    );
  } finally {
    await f.executor.dispose();
  }
});

test("owner 세대 변경은 새 명령을 적용하지 않고 서버 권한을 자동 해제하지 않아요", async () => {
  const f = await fixture();
  await f.opened.promise;
  f.send([], { ownerEpoch: 2 });
  await f.disconnected.promise;
  await f.executor.dispose();
  expect(f.calls).toEqual([]);
  expect(f.paths.some((path) => path.endsWith("/release"))).toBe(false);
});

test("재생 채널의 인증 철회는 실행기와 구독을 정리해요", async () => {
  const f = await fixture(401);
  await f.disconnected.promise;
  await f.executor.dispose();
  expect(f.calls).toEqual([]);
  expect(f.provider.controls.subscriberCount).toBe(0);
});
