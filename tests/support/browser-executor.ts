import type {
  PlaybackCommand,
  PlaybackObservation,
  PlaybackPort,
} from "../../src/music/contracts";
import { createContrastingProvider } from "../../src/music/testing/contrasting-provider";
import {
  BrowserPlaybackExecutor,
  type BrowserPlaybackSnapshot,
} from "../../src/pages/admin/playback-runtime";

const bootstrap = await fetch("/__qa/bootstrap");
const token = bootstrap.headers.get("x-qa-admin-token");
if (!bootstrap.ok || !token) throw new Error("테스트 관리자 인증이 없어요");

const fixture = createContrastingProvider({ location: "browser" });
const signal = new AbortController().signal;
const auth = await fixture.provider.auth.connect(signal);
if (!auth.ok) throw new Error("테스트 SDK 인증에 실패했어요");
const targets = await fixture.runtime.connection.listTargets(signal);
if (!targets.ok || !targets.value[0])
  throw new Error("테스트 재생 대상이 없어요");
const connection = await fixture.runtime.connection.connect(
  targets.value[0].ref,
  signal,
);
if (!connection.ok) throw new Error("테스트 재생 대상에 연결할 수 없어요");

const stats = {
  snapshot: null as BrowserPlaybackSnapshot | null,
  commands: [] as PlaybackCommand[],
  observations: [] as PlaybackObservation[],
  requests: [] as { path: string; status: number; body: unknown }[],
  disconnected: [] as string[],
  failures: [] as string[],
  disposed: false,
  autoDeliver: true,
};

function notify() {
  window.dispatchEvent(new Event("qa-lifecycle"));
  // 같은 프로필의 두 번째 문서는 opener의 조건 구독에도 상태를 알려줘요.
  if (window.opener && !window.opener.closed) {
    window.opener.dispatchEvent(new window.opener.Event("qa-lifecycle"));
  }
}

window.addEventListener("error", (event) => {
  stats.failures.push(event.message);
  notify();
});
window.addEventListener("unhandledrejection", (event) => {
  stats.failures.push(String(event.reason));
  notify();
});

function deliver() {
  for (const sequence of fixture.controls.pendingSequences()) {
    fixture.controls.deliver(sequence);
  }
}

const playback: PlaybackPort = {
  async execute(command, abort) {
    stats.commands.push(command);
    notify();
    return fixture.runtime.playback.execute(command, abort);
  },
  async *observe(abort) {
    for await (const observation of fixture.runtime.playback.observe(abort)) {
      stats.observations.push(observation);
      notify();
      yield observation;
    }
  },
  reconcile: (binding, abort) =>
    fixture.runtime.playback.reconcile(binding, abort),
  async dispose() {
    await fixture.runtime.playback.dispose();
    stats.disposed = true;
    notify();
  },
};

const executor = new BrowserPlaybackExecutor({
  token,
  connection: connection.value,
  playback,
  async fetcher(path, init) {
    // 프로토콜 응답은 전부 실제 서버에서 받아요. SDK 관측 전달만 제어해요.
    const response = await fetch(path, init);
    stats.requests.push({
      path,
      status: response.status,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    if (response.ok && path.endsWith("/receipt") && stats.autoDeliver) {
      deliver();
    }
    notify();
    return response;
  },
  onSnapshot(snapshot) {
    stats.snapshot = snapshot;
    notify();
  },
  onDisconnected(error) {
    stats.disconnected.push(String(error));
    notify();
  },
});

const harness = {
  executor,
  stats,
  deliver,
  async start() {
    try {
      await executor.start();
      return true;
    } catch {
      return false;
    }
  },
  async api(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  },
  async dispose() {
    await executor.dispose();
    await fixture.provider.dispose();
  },
};

declare global {
  interface Window {
    __playback: typeof harness;
    __peer: Window | null;
  }
}

window.__playback = harness;
document.querySelector("#open-peer")?.addEventListener("click", (event) => {
  if (!event.isTrusted) throw new Error("실제 사용자 클릭이 필요해요");
  window.__peer = window.open("/__qa/player", "_blank");
  if (!window.__peer) throw new Error("두 번째 문서를 열지 못했어요");
});
window.addEventListener("pagehide", () => void harness.dispose(), {
  once: true,
});
notify();
