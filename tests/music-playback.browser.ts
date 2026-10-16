import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PlaybackSnapshot } from "../src/domains/playback/protocol";
import { armCondition, expectCondition } from "./support/browser-lifecycle";
import { independentBrowser } from "./support/independent-browser";
import { startServerProcess } from "./support/server-process";

const directory = await mkdtemp(join(tmpdir(), "jukebox-playback-browser-"));
const token = randomBytes(32).toString("hex");
let server: Awaited<ReturnType<typeof startServerProcess>> | undefined;
let proxy: ReturnType<typeof Bun.serve> | undefined;
const browsers: Array<Bun.WebView | ReturnType<typeof independentBrowser>> = [];
const streams = new Map<string, AbortController>();
const urls: string[] = [];

try {
  const bundle = await Bun.build({
    entrypoints: [resolve("tests/support/browser-executor.ts")],
    target: "browser",
    format: "esm",
  });
  assert(bundle.success, bundle.logs.map(String).join("\n"));
  assert.equal(bundle.outputs.length, 1);
  const entry = bundle.outputs[0]!;
  server = await startServerProcess({
    command: [
      process.execPath,
      resolve("tests/support/browser-player-server-entry.ts"),
    ],
    env: {
      ...process.env,
      PORT: "0",
      BASE_URL: "http://127.0.0.1",
      DATABASE_URL: `file:${join(directory, "playback.sqlite")}`,
      ADMIN_TOKEN: token,
      DEVICE_COOKIE_SECRET: randomBytes(32).toString("hex"),
    },
  });
  const upstream = server.url;
  proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 255,
    async fetch(request) {
      urls.push(request.url);
      const url = new URL(request.url);
      if (url.pathname === "/__qa/bootstrap") {
        return new Response(null, {
          headers: { "x-qa-admin-token": token, "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === "/__qa/executor.js") {
        return new Response(entry, {
          headers: { "Content-Type": "text/javascript" },
        });
      }
      if (url.pathname === "/__qa/player") {
        return new Response(
          `<!doctype html><html lang="ko"><meta charset="utf-8">
          <title>브라우저 재생 계약 검증</title>
          <button id="open-peer">같은 프로필에서 두 번째 문서 열기</button>
          <script>window.__ready = import("/__qa/executor.js");</script></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      const target = new URL(url.pathname + url.search, upstream);
      if (url.pathname !== "/api/admin/playback/events") {
        return fetch(new Request(target, request), { redirect: "manual" });
      }

      // 실제 SSE 바이트를 전달하고 연결 상실 시에만 전송을 끊어요.
      const id = url.searchParams.get("executorSessionId");
      assert(id);
      assert.equal(request.headers.get("x-admin-token"), token);
      const abort = new AbortController();
      streams.set(id, abort);
      let cancelled = false;
      const response = await fetch(new Request(target, request), {
        signal: AbortSignal.any([request.signal, abort.signal]),
      });
      assert(response.body);
      const source = response.body;
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of source) controller.enqueue(chunk);
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
    },
  });
  const url = `http://127.0.0.1:${proxy.port}/__qa/player`;
  const first = new Bun.WebView({
    backend: { type: "chrome", url: false },
    width: 1200,
    height: 800,
  });
  browsers.push(first);
  await first.navigate(url);
  await first.evaluate("window.__ready");
  const profile = randomBytes(16).toString("hex");
  await first.evaluate(
    `localStorage.setItem("qa-profile", ${JSON.stringify(profile)})`,
  );
  await armCondition(first, "!!window.__peer?.__playback");
  await first.click("#open-peer");
  await expectCondition(first, "같은 프로필의 두 번째 문서가 준비돼요");
  assert.equal(
    await first.evaluate('window.__peer.localStorage.getItem("qa-profile")'),
    profile,
  );
  assert.equal(await first.evaluate("window.__peer !== window"), true);

  const independent = independentBrowser();
  browsers.push(independent);
  await independent.navigate(url);
  await independent.evaluate("window.__ready");
  assert.equal(
    await independent.evaluate('localStorage.getItem("qa-profile")'),
    null,
    "두 번째 WebView의 브라우저 저장소가 독립적이어야 해요",
  );
  await independent.evaluate(
    'localStorage.setItem("qa-profile", "independent")',
  );
  assert.equal(
    await first.evaluate('localStorage.getItem("qa-profile")'),
    profile,
  );

  const own = "window.__playback";
  const peer = "window.__peer.__playback";
  const firstId = await first.evaluate<string>(
    `${own}.executor.executorSessionId`,
  );
  const peerId = await first.evaluate<string>(
    `${peer}.executor.executorSessionId`,
  );
  const independentId = await independent.evaluate<string>(
    `${own}.executor.executorSessionId`,
  );
  assert.equal(new Set([firstId, peerId, independentId]).size, 3);

  async function snapshot(): Promise<PlaybackSnapshot> {
    const response = await fetch(`${upstream}/api/admin/playback/snapshot`, {
      headers: { "x-admin-token": token },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  async function denied(
    browser:
      | Pick<Bun.WebView, "evaluate">
      | ReturnType<typeof independentBrowser>,
    player: string,
  ) {
    assert.equal(await browser.evaluate(`${player}.start()`), false);
    const claims = await browser.evaluate<number[]>(
      `${player}.stats.requests.filter(r => r.path === "/api/admin/playback/owner").map(r => r.status)`,
    );
    assert(claims.length > 0);
    assert(claims.every((status) => status >= 400));
    assert.deepEqual(await browser.evaluate(`${player}.stats.commands`), []);
  }

  await armCondition(
    first,
    `${own}.stats.snapshot?.owner?.executorSessionId === ${JSON.stringify(firstId)}`,
  );
  assert.equal(await first.evaluate(`${own}.start()`), true);
  await expectCondition(first, "첫 문서가 실제 서버의 owner가 돼요");
  const initial = await snapshot();
  assert(initial.owner);
  const staleIdentity = {
    ownerEpoch: initial.owner.ownerEpoch,
    executorSessionId: firstId,
  };

  await denied(first, peer);
  await denied(independent, own);
  await armCondition(
    first,
    `${own}.stats.snapshot?.attempt?.state === "playing"`,
  );
  assert.equal(
    await first.evaluate(
      `${own}.api("/api/admin/add", { providerId: "test-radio", trackId: "Mix:Aa/_?한글" }).then(r => r.status)`,
    ),
    201,
  );
  await expectCondition(first, "첫 owner만 SDK에 재생 명령을 실행해요");
  assert.deepEqual(
    await first.evaluate(`${own}.stats.commands.map(c => c.type)`),
    ["play"],
  );
  assert.deepEqual(await first.evaluate(`${peer}.stats.commands`), []);
  assert.deepEqual(await independent.evaluate(`${own}.stats.commands`), []);
  assert.equal(
    await first.evaluate(
      `${own}.api("/api/admin/add", { providerId: "test-radio", trackId: "mix:aa/_?한글" }).then(r => r.status)`,
    ),
    201,
  );

  // receipt만 받은 상태와 실제 stopped 관측을 받은 상태를 분리해요.
  await first.evaluate(`${own}.stats.autoDeliver = false`);
  await armCondition(
    first,
    `${own}.stats.requests.some(r => r.path.endsWith("/receipt") && r.status === 201
      && r.body.outcome.context.commandId === ${own}.stats.commands.find(c => c.type === "stop")?.context.commandId)`,
  );
  await first.evaluate(`(() => {
    window.__releaseResult = null;
    window.__release = ${own}.api("/api/admin/playback/release", ${JSON.stringify(staleIdentity)})
      .then(result => { window.__releaseResult = result; window.dispatchEvent(new Event("qa-lifecycle")); });
  })()`);
  await expectCondition(first, "정지 receipt가 서버에 도착해요");
  const waitingForStop = await snapshot();
  assert.equal(waitingForStop.owner?.released, false);
  assert.equal(waitingForStop.owner?.stopConfirmed, false);
  assert.equal(waitingForStop.owner?.executorSessionId, firstId);
  assert.equal(await first.evaluate("window.__releaseResult"), null);
  assert.deepEqual(await first.evaluate(`${peer}.stats.commands`), []);
  assert.deepEqual(await independent.evaluate(`${own}.stats.commands`), []);

  await armCondition(
    first,
    `window.__releaseResult?.status === 201 && ${own}.stats.disposed`,
  );
  await first.evaluate(`${own}.deliver()`);
  await expectCondition(first, "stopped 관측 뒤에만 owner를 해제해요");
  await first.evaluate(`${own}.executor.dispose()`);
  const released = await snapshot();
  assert.equal(released.owner?.released, true);
  assert.equal(released.owner?.stopConfirmed, true);
  assert.equal(
    await first.evaluate(
      `${own}.stats.observations.some(o => o.state === "stopped" && o.correlation?.executorSessionId === ${JSON.stringify(firstId)})`,
    ),
    true,
  );

  await armCondition(
    first,
    `${peer}.stats.snapshot?.owner?.executorSessionId === ${JSON.stringify(peerId)}
      && ${peer}.stats.snapshot?.attempt?.state === "playing"`,
  );
  assert.equal(await first.evaluate(`${peer}.start()`), true);
  await expectCondition(first, "같은 프로필의 다른 문서로 명시적으로 양도해요");
  const transferred = await snapshot();
  assert(transferred.owner && transferred.attempt);
  assert(transferred.owner.ownerEpoch > initial.owner.ownerEpoch);
  assert.deepEqual(
    await first.evaluate(
      `${peer}.stats.commands.filter(c => c.type === "play").map(c => c.trackRef.trackId)`,
    ),
    ["mix:aa/_?한글"],
  );
  const retiredCommands = await first.evaluate(`${own}.stats.commands`);
  await denied(independent, own);

  // 현재 attempt에 맞춘 메시지여도 이전 owner의 epoch/session이면 거절해요.
  const staleObservation = {
    ...staleIdentity,
    observation: {
      state: "ended",
      endReason: "natural-end",
      trackRef: { providerId: "test-radio", trackId: "mix:aa/_?한글" },
      target: transferred.owner.connection.target,
      connectionGeneration: transferred.owner.connection.connectionGeneration,
      correlation: transferred.attempt.context,
      binding: transferred.attempt.binding,
      sequence: transferred.attempt.sequence + 1,
      positionSec: 98.5,
      durationSec: 98.5,
    },
  };
  for (const [path, body] of [
    ["/api/admin/playback/observation", staleObservation],
    [
      "/api/admin/playback/receipt",
      {
        ...staleIdentity,
        outcome: { status: "accepted", context: transferred.attempt.context },
      },
    ],
    ["/api/admin/playback/release", staleIdentity],
  ] as const) {
    assert.equal(
      await first.evaluate(
        `${own}.api(${JSON.stringify(path)}, ${JSON.stringify(body)}).then(r => r.status)`,
      ),
      409,
      "이전 owner의 메시지가 현재 재생을 바꾸면 안 돼요",
    );
  }
  const afterStale = await snapshot();
  assert.equal(afterStale.owner?.ownerEpoch, transferred.owner.ownerEpoch);
  assert.deepEqual(afterStale.attempt, transferred.attempt);

  await armCondition(
    first,
    `${peer}.stats.snapshot?.attempt?.state === "paused"`,
  );
  assert.equal(
    await first.evaluate(
      `${peer}.api("/api/admin/pause", {}).then(r => r.status)`,
    ),
    201,
  );
  await expectCondition(first, "양도 뒤 제어는 새 owner의 SDK만 실행해요");
  assert.deepEqual(
    await first.evaluate(`${own}.stats.commands`),
    retiredCommands,
  );
  assert.deepEqual(
    await first.evaluate(`${peer}.stats.commands.map(c => c.type)`),
    ["play", "pause"],
  );

  const claimsBeforeDisconnect = await independent.evaluate(
    `${own}.stats.requests.length`,
  );
  await armCondition(
    first,
    `${peer}.stats.disconnected.length === 1 && ${peer}.stats.disposed`,
  );
  const stream = streams.get(peerId);
  assert(stream, "owner의 실제 SSE 연결이 열려 있어야 해요");
  stream.abort();
  await expectCondition(first, "SSE 상실 시 실행기를 정리해요");
  await first.evaluate(`${peer}.executor.dispose()`);
  assert.equal(
    await independent.evaluate(`${own}.stats.requests.length`),
    claimsBeforeDisconnect,
    "연결 상실만으로 대기 문서가 자동 owner 요청을 보내지 않아요",
  );
  await denied(independent, own);
  const disconnected = await snapshot();
  assert.equal(disconnected.owner?.executorSessionId, peerId);
  assert.equal(disconnected.owner?.ownerEpoch, transferred.owner.ownerEpoch);
  assert.equal(disconnected.owner?.released, false);
  assert.equal(disconnected.owner?.stopConfirmed, false);
  assert.equal(disconnected.attempt?.state, "paused");
  assert.deepEqual(
    await first.evaluate(`${own}.stats.commands`),
    retiredCommands,
  );
  for (const [browser, player] of [
    [first, own],
    [first, peer],
    [independent, own],
  ] as const) {
    assert.deepEqual(await browser.evaluate(`${player}.stats.failures`), []);
  }
  assert.equal(
    urls.some((requestUrl) => requestUrl.includes(token)),
    false,
  );
  console.info(
    "브라우저 재생: 같은 프로필 두 문서·독립 컨텍스트 단일 owner·stopped 후 양도·stale 차단·연결 상실 뒤 자동 양도 금지 검증 통과",
  );
} catch (error) {
  if (server) console.error(server.output);
  throw error;
} finally {
  // 실패 지점과 상관없이 popup, SDK, SSE, Chrome, 서버, DB를 모두 정리해요.
  await Promise.allSettled(
    browsers.map((browser) =>
      browser.evaluate(`(async () => {
        await Promise.allSettled([
          window.__playback?.dispose(),
          window.__peer?.__playback?.dispose(),
        ]);
        window.__peer?.close();
      })()`),
    ),
  );
  for (const browser of browsers) await browser[Symbol.asyncDispose]();
  for (const stream of streams.values()) stream.abort();
  await proxy?.stop(true);
  await server?.stop();
  await rm(directory, { recursive: true, force: true });
}
