import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import type { PlaybackSnapshot } from "../../src/domains/playback/protocol";
import { createContrastingProvider } from "../../src/music/testing";
import { playbackEvents } from "../../src/pages/admin/playback-channel";
import { BrowserPlaybackExecutor } from "../../src/pages/admin/playback-runtime";
import { startServerProcess } from "./server-process";

export const recoveryScenarios = [
  "browser-recovery",
  "stale-recovery-fence",
  "recovery-rollback-idle",
] as const;

// 실제 HTTP/SSE·SQLite를 검사해요. 음원 공급자 자체는 계약용 fixture예요.
export async function runRecoveryScenario(
  scenario: (typeof recoveryScenarios)[number],
) {
  const directory = await mkdtemp(join(tmpdir(), `jukebox-${scenario}-`));
  const token = "qa-local-only";
  const databaseUrl = `file:${join(directory, "recovery.sqlite")}`;
  const abort = new AbortController();
  const fixture = createContrastingProvider({ location: "browser" });
  const executors: BrowserPlaybackExecutor[] = [];
  const actions: unknown[] = [];
  const assertions: string[] = [];
  const cleanup: Record<string, unknown> = { directory };
  let server: Awaited<ReturnType<typeof startServerProcess>> | undefined;
  let database: ReturnType<typeof createClient> | undefined;
  let stream: Promise<void> | undefined;
  let latest: PlaybackSnapshot | null = null;
  const watchers = new Set<() => void>();
  let streamError: unknown;
  const wait = (predicate: (snapshot: PlaybackSnapshot) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("복구 SSE 상태 시간 초과")),
        20000,
      );
      const finish = (error?: unknown) => {
        clearTimeout(timeout);
        watchers.delete(check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (streamError) finish(streamError);
        else if (latest && predicate(latest)) finish();
      };
      watchers.add(check);
      check();
    });
  try {
    server = await startServerProcess({
      command: [
        process.execPath,
        resolve("tests/support/browser-player-server-entry.ts"),
      ],
      env: {
        ...process.env,
        PORT: "0",
        BASE_URL: "http://127.0.0.1",
        DATABASE_URL: databaseUrl,
        ADMIN_TOKEN: token,
        DEVICE_COOKIE_SECRET: token,
      },
    });
    const url = server.url;
    actions.push({ server: url, database: databaseUrl });
    database = createClient({ url: databaseUrl });
    const api = async (path: string, body?: unknown, authorized = true) => {
      const response = await fetch(url + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorized ? { "x-admin-token": token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const result = {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers].map(([key, value]) => [
            key,
            key === "set-cookie" ? "[redacted]" : value,
          ]),
        ),
        body: await response.json(),
      };
      actions.push({ path, ...result });
      return result;
    };
    const snapshot = async (): Promise<PlaybackSnapshot> => {
      const result = await api("/api/admin/playback/snapshot");
      assert.equal(result.status, 200);
      return result.body;
    };
    const persisted = async () => {
      const rows: Record<string, unknown> = {};
      for (const table of [
        "playback_owner",
        "playback_attempts",
        "playback_commands",
        "now_playing",
        "history",
        "queue",
      ]) {
        rows[table] = (
          await database!.execute(`SELECT * FROM ${table} ORDER BY id`)
        ).rows;
      }
      return rows;
    };
    const memory = async () => (await api("/api/state")).body;
    const initial = wait(() => true);
    stream = (async () => {
      for await (const event of playbackEvents(
        token,
        "recovery-observer",
        abort.signal,
        (path, init) => fetch(url + path, init),
      )) {
        if (event.event !== "snapshot") continue;
        latest = event.data as PlaybackSnapshot;
        for (const check of [...watchers]) check();
      }
    })().catch((error: unknown) => {
      streamError = error;
      for (const check of [...watchers]) check();
    });
    await initial;

    const auth = await fixture.provider.auth.connect(abort.signal);
    assert(auth.ok);
    const targets = await fixture.runtime.connection.listTargets(abort.signal);
    assert(targets.ok && targets.value[0]);
    const connected = await fixture.runtime.connection.connect(
      targets.value[0].ref,
      abort.signal,
    );
    assert(connected.ok);
    const prior = await api("/api/admin/playback/owner", {
      executorSessionId: "prior-idle-browser",
      connection: connected.value,
    });
    assert.equal(prior.status, 201);
    assert.equal(
      (
        await api("/api/admin/playback/confirm-browser-stopped", {
          ownerEpoch: prior.body.owner.ownerEpoch,
          executorSessionId: "prior-idle-browser",
          attemptId: null,
          songId: null,
        })
      ).status,
      201,
    );
    const executor = new BrowserPlaybackExecutor({
      token,
      connection: connected.value,
      playback: fixture.runtime.playback,
      fetcher: async (path, init) => {
        const response = await fetch(url + path, init);
        if (response.ok && path.endsWith("/receipt")) {
          for (const sequence of fixture.controls.pendingSequences())
            fixture.controls.deliver(sequence);
        }
        return response;
      },
    });
    executors.push(executor);
    await executor.start();
    const playing = wait((s) => s.attempt?.state === "playing");
    assert.equal(
      (
        await api("/api/admin/add", {
          providerId: "test-radio",
          trackId: "Mix:Aa/_?한글",
        })
      ).status,
      201,
    );
    await playing;
    assert.equal(
      (
        await api("/api/admin/add", {
          providerId: "test-radio",
          trackId: "mix:aa/_?한글",
        })
      ).status,
      201,
    );
    const active = await snapshot();
    assert(active.owner && active.attempt);
    const fence = {
      ownerEpoch: active.owner.ownerEpoch,
      executorSessionId: active.owner.executorSessionId,
      attemptId: active.attempt.attemptId,
      songId: active.attempt.songId,
    };
    const expired = wait(
      (s) =>
        !s.ownerConnected && s.attempt?.state === "reconciliation-required",
    );
    await executor.dispose();
    await expired;
    const lost = await snapshot();
    assert.equal(lost.owner?.released, false);
    assert.equal(lost.owner?.stopConfirmed, false);
    assert.equal(lost.attempt?.attemptId, active.attempt.attemptId);
    assertions.push("lease-expired-without-release", "attempt-preserved");

    const path = "/api/admin/playback/confirm-browser-stopped";
    assert.equal((await api(path, fence, false)).status, 401);
    for (const invalid of [
      { ...fence, ownerEpoch: -1 },
      { ...fence, ownerEpoch: 1.5 },
      { ...fence, executorSessionId: "" },
      { ...fence, songId: null },
      {
        ownerEpoch: fence.ownerEpoch,
        executorSessionId: fence.executorSessionId,
      },
    ]) {
      assert.equal((await api(path, invalid)).status, 400);
    }
    assertions.push("malformed-and-unauthorized-rejected");

    if (scenario === "stale-recovery-fence") {
      const before = {
        sql: await persisted(),
        memory: await memory(),
        admin: await snapshot(),
      };
      for (const stale of [
        { ...fence, ownerEpoch: fence.ownerEpoch - 1 },
        { ...fence, executorSessionId: "stale-executor" },
        { ...fence, attemptId: "stale-attempt" },
        { ...fence, songId: "stale-song" },
        { ...fence, attemptId: null, songId: null },
      ]) {
        assert.equal((await api(path, stale)).status, 409);
        assert.deepEqual(
          {
            sql: await persisted(),
            memory: await memory(),
            admin: await snapshot(),
          },
          before,
        );
      }
      assertions.push("stale-active-fence-no-change");
    }

    if (scenario === "recovery-rollback-idle") {
      await database.execute(
        "CREATE TRIGGER fail_recovery_release BEFORE UPDATE ON playback_owner WHEN json_extract(NEW.data, '$.released') = 1 BEGIN SELECT RAISE(ABORT, 'QA owner release rollback'); END",
      );
      const before = {
        sql: await persisted(),
        memory: await memory(),
        admin: await snapshot(),
      };
      assert.equal((await api(path, fence)).status, 500);
      const after = {
        sql: await persisted(),
        memory: await memory(),
        admin: await snapshot(),
      };
      assert.deepEqual(after, before);
      actions.push({ rollback: { before, after } });
      await database.execute("DROP TRIGGER fail_recovery_release");
      assertions.push(
        "rollback-owner-attempt-command-nowPlaying-history-queue-memory",
      );
    }

    const reservationCount = (
      await database.execute("SELECT count(*) AS n FROM playback_attempts")
    ).rows[0]!.n;
    assert.equal((await api(path, fence)).status, 201);
    const released = await snapshot();
    assert.equal(released.owner?.released, true);
    assert.equal(released.owner?.stopConfirmed, true);
    assert.equal(released.ownerConnected, false);
    assert.equal(released.attempt, null);
    assert.equal(
      (await database.execute("SELECT count(*) AS n FROM playback_attempts"))
        .rows[0]!.n,
      reservationCount,
    );
    assert.equal(
      (await database.execute("SELECT count(*) AS n FROM queue")).rows[0]!.n,
      1,
    );
    assert.equal(
      (await database.execute("SELECT count(*) AS n FROM history")).rows[0]!.n,
      1,
    );
    assert.equal((await api(path, fence)).status, 409);
    assert.equal(
      (
        await api("/api/admin/playback/observation", {
          ownerEpoch: fence.ownerEpoch,
          executorSessionId: fence.executorSessionId,
          observation: {
            ...active.attempt.context,
            correlation: active.attempt.context,
            binding: active.attempt.binding,
            trackRef: { providerId: "test-radio", trackId: "Mix:Aa/_?한글" },
            sequence: active.attempt.sequence + 1,
            state: "ended",
            endReason: "natural-end",
            positionSec: 0,
            durationSec: null,
          },
        })
      ).status,
      409,
    );
    assertions.push(
      "history-exactly-once",
      "no-next-reservation-before-fresh-claim",
      "late-event-rejected",
    );

    if (scenario === "recovery-rollback-idle") {
      // 남은 신청은 그대로 두고 별도의 빈 DB에서 idle 복구를 검사하지 않아요.
      // 실제 API로 대기 신청을 취소한 뒤 같은 owner 저장소를 계속 사용해요.
      const queued = (await memory()).queue[0];
      assert(queued);
      const deletion = await api("/api/admin/remove", { id: queued.id });
      assert.equal(deletion.status, 201);
      assert.equal(deletion.body.ok, true);
    }
    const nextReserved =
      scenario === "recovery-rollback-idle"
        ? null
        : wait(
            (s) =>
              s.attempt !== null && s.attempt.attemptId !== fence.attemptId,
          );
    const nextClaim = await api("/api/admin/playback/owner", {
      executorSessionId: "fresh-browser",
      connection: connected.value,
    });
    assert.equal(nextClaim.status, 201);
    assert.equal(nextClaim.body.owner.ownerEpoch, fence.ownerEpoch + 1);
    await nextReserved;
    assertions.push("fresh-claim-increments-epoch");
    if (scenario === "recovery-rollback-idle") {
      const idle = {
        ownerEpoch: nextClaim.body.owner.ownerEpoch,
        executorSessionId: "fresh-browser",
        attemptId: null,
        songId: null,
      };
      const before = { sql: await persisted(), memory: await memory() };
      assert.equal(
        (await api(path, { ...idle, ownerEpoch: fence.ownerEpoch })).status,
        409,
      );
      assert.deepEqual(
        { sql: await persisted(), memory: await memory() },
        before,
      );
      assert.equal((await api(path, idle)).status, 201);
      assert.equal((await snapshot()).owner?.released, true);
      assert.equal((await api(path, idle)).status, 409);
      assertions.push("idle-null-body-released", "stale-idle-fence-no-change");
    }
  } catch (error) {
    console.error(
      JSON.stringify({ scenario, result: "FAIL", assertions, actions }),
    );
    console.error(server?.output);
    throw error;
  } finally {
    await Promise.all(executors.map((executor) => executor.dispose()));
    await fixture.provider.dispose();
    abort.abort();
    await stream;
    database?.close();
    await server?.stop();
    if (server) {
      await assert.rejects(
        fetch(server.url, { signal: AbortSignal.timeout(1000) }),
      );
      cleanup.serverUrl = server.url;
      cleanup.portClosed = true;
    }
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(access(directory));
    cleanup.directoryRemoved = true;
    cleanup.providerSubscribers = fixture.controls.subscriberCount;
    assert.equal(fixture.controls.subscriberCount, 0);
    assert.equal(watchers.size, 0);
  }
  console.info(
    JSON.stringify({
      scenario,
      result: "PASS",
      providerEvidence: "simulated",
      surface: "production HTTP/SSE and live SQLite",
      assertions,
      actions,
      cleanup,
    }),
  );
}
