import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createContrastingProvider } from "../src/music/testing";
import {
  BrowserPlaybackExecutor,
  type BrowserPlaybackSnapshot,
} from "../src/pages/admin/playback-runtime";
import {
  recoveryScenarios,
  runRecoveryScenario,
} from "./support/browser-recovery-scenarios";
import { startServerProcess } from "./support/server-process";

const args = process.argv.slice(2);
const selected = args.length === 2 && args[0] === "--scenario" ? args[1] : null;
if (
  args.length > 0 &&
  (!selected || !["protocol", ...recoveryScenarios].includes(selected))
) {
  throw new Error(`알 수 없는 재생 시나리오예요: ${args.join(" ")}`);
}

async function runProtocol() {
  const directory = await mkdtemp(join(tmpdir(), "jukebox-protocol-"));
  const token = randomBytes(32).toString("hex");
  const server = await startServerProcess({
    command: [
      process.execPath,
      resolve("tests/support/browser-player-server-entry.ts"),
    ],
    env: {
      ...process.env,
      PORT: "0",
      BASE_URL: "http://127.0.0.1",
      DATABASE_URL: `file:${join(directory, "protocol.sqlite")}`,
      ADMIN_TOKEN: token,
      DEVICE_COOKIE_SECRET: token,
    },
  });
  const clients: BrowserPlaybackExecutor[] = [];
  async function api(path: string, body?: unknown, authorized = true) {
    const response = await fetch(server.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorized ? { "x-admin-token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  }
  async function client() {
    const fixture = createContrastingProvider({ location: "browser" });
    const signal = new AbortController().signal;
    const auth = await fixture.provider.auth.connect(signal);
    assert(auth.ok);
    const targets = await fixture.runtime.connection.listTargets(signal);
    assert(targets.ok && targets.value[0]);
    const connected = await fixture.runtime.connection.connect(
      targets.value[0].ref,
      signal,
    );
    assert(connected.ok);
    let snapshot: BrowserPlaybackSnapshot | null = null;
    const watchers = new Set<() => void>();
    const disconnected: unknown[] = [];
    const executor = new BrowserPlaybackExecutor({
      token,
      playback: fixture.runtime.playback,
      connection: connected.value,
      fetcher: async (url, init) => {
        const response = await fetch(server.url + url, init);
        if (response.ok && url.endsWith("/receipt")) {
          for (const sequence of fixture.controls.pendingSequences())
            fixture.controls.deliver(sequence);
        }
        return response;
      },
      onSnapshot: (next) => {
        snapshot = next;
        for (const watcher of watchers) watcher();
      },
      onDisconnected: (error) => disconnected.push(error),
    });
    clients.push(executor);
    return {
      executor,
      fixture,
      connected: connected.value,
      disconnected,
      get snapshot() {
        return snapshot;
      },
      wait(predicate: (snapshot: BrowserPlaybackSnapshot) => boolean) {
        if (snapshot && predicate(snapshot)) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            watchers.delete(check);
            reject(new Error("재생 상태 시간 초과"));
          }, 10000);
          const check = () => {
            if (!snapshot || !predicate(snapshot)) return;
            clearTimeout(timeout);
            watchers.delete(check);
            resolve();
          };
          watchers.add(check);
          check();
        });
      },
    };
  }

  try {
    assert.equal(
      (await api("/api/admin/playback/snapshot", undefined, false)).status,
      401,
    );
    const first = await client();
    const second = await client();
    await first.executor.start();
    await first.wait(
      (s) => s.owner?.executorSessionId === first.executor.executorSessionId,
    );
    const firstOwner = first.snapshot?.owner;
    assert(firstOwner);
    await assert.rejects(second.executor.start());
    assert.equal(
      (
        await api(
          "/api/admin/playback/owner",
          {
            executorSessionId: "guest",
            connection: first.connected,
          },
          false,
        )
      ).status,
      401,
    );
    const identity = {
      ownerEpoch: firstOwner.ownerEpoch,
      executorSessionId: first.executor.executorSessionId,
    };
    assert.equal(
      (
        await api("/api/admin/playback/receipt", {
          ...identity,
          outcome: { status: "accepted", context: {} },
        })
      ).status,
      400,
    );
    const added = await api("/api/admin/add", {
      providerId: "test-radio",
      trackId: "Mix:Aa/_?한글",
    });
    assert.equal(added.status, 201);
    await first.wait((s) => s.attempt?.state === "playing");
    const originalAttempt = first.snapshot?.attempt;
    assert(originalAttempt);
    assert.equal((await api("/api/admin/pause", {})).status, 201);
    await first.wait((s) => s.attempt?.state === "paused");
    assert.equal((await api("/api/admin/resume", {})).status, 201);
    await first.wait((s) => s.attempt?.state === "playing");
    assert.equal((await api("/api/admin/previous", {})).status, 201);
    await first.wait(
      (s) =>
        s.attempt?.state === "playing" &&
        s.attempt.attemptId !== originalAttempt.attemptId,
    );
    assert.equal(
      (
        await api("/api/admin/add", {
          providerId: "test-radio",
          trackId: "mix:aa/_?한글",
        })
      ).status,
      201,
    );
    assert.equal(
      (await api("/api/admin/playback/release", identity)).status,
      201,
    );
    await second.executor.start();
    await second.wait(
      (s) =>
        s.owner?.executorSessionId === second.executor.executorSessionId &&
        s.attempt?.state === "playing",
    );
    assert(second.snapshot?.owner);
    assert(second.snapshot.owner.ownerEpoch > firstOwner.ownerEpoch);
    assert.equal(
      (await api("/api/admin/playback/release", identity)).status,
      409,
    );
    const publicState = JSON.stringify((await api("/api/state")).body);
    for (const secret of [
      "ownerEpoch",
      "executorSessionId",
      "connectionGeneration",
      "binding",
      "commands",
    ]) {
      assert.equal(publicState.includes(secret), false);
    }
    await second.executor.dispose();
    const third = await client();
    await assert.rejects(third.executor.start());
    const current = (await api("/api/admin/playback/snapshot")).body;
    assert(current.attempt && current.owner);
    assert.equal(current.owner.released, false);
    assert.equal(
      (
        await api("/api/admin/playback/observation", {
          ...identity,
          observation: {
            state: "ended",
            endReason: "natural-end",
            trackRef: { providerId: "test-radio", trackId: "mix:aa/_?한글" },
            target: current.owner.connection.target,
            connectionGeneration: current.owner.connection.connectionGeneration,
            correlation: current.attempt.context,
            binding: null,
            sequence: current.attempt.sequence + 1,
            positionSec: 98.5,
            durationSec: 98.5,
          },
        })
      ).status,
      409,
    );
    console.info(
      JSON.stringify({
        scenario: "protocol",
        result: "PASS",
        assertions: [
          "single-owner",
          "observed-controls",
          "stop-before-release",
          "stale-rejected",
          "public-state-boundary",
        ],
        providerEvidence: "simulated",
      }),
    );
  } catch (error) {
    console.error(server.output);
    throw error;
  } finally {
    await Promise.allSettled(clients.map((executor) => executor.dispose()));
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

if (!selected || selected === "protocol") await runProtocol();
for (const scenario of recoveryScenarios) {
  if (!selected || selected === scenario) await runRecoveryScenario(scenario);
}
