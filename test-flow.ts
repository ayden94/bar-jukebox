import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Runs the built server against a private SQLite file and intercepts iTunes only in its child process.
type Song = {
  id: string;
  trackId: number;
  trackName: string;
  artistName: string;
  albumUrl: string;
  artworkUrl: string;
  trackNumber: number;
  durationSec: number;
  requestedBy: string;
  isMine: boolean;
  isStaff: boolean;
};
type State = {
  queue: Song[];
  nowPlaying: { song: Song } | null;
  history: Song[];
  requestsPaused: boolean;
  notice: string;
  maxPerDevice: number;
  maxPerTable: number;
};
type Table = { id: number; label: string; url: string };
type ApiData = {
  ok: boolean;
  table: Table;
  hits: Song[];
  song: Song;
  tableId: number;
};

function bounded<T>(
  promise: Promise<T>,
  label: string,
  ms = 10000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function run() {
  const directory = await mkdtemp(join(tmpdir(), "jukebox-flow-"));
  let base = "";
  const token = randomBytes(32).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const preload = resolve("tests/support/itunes-preload.ts");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let output = "";
  const spawnServer = async () => {
    child = Bun.spawn(
      ["bun", "--preload", preload, resolve("dist/server/main.js")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: "0",
          BASE_URL: "http://127.0.0.1",
          DATABASE_URL: `file:${join(directory, "flow.sqlite")}`,
          ADMIN_TOKEN: token,
          DEVICE_COOKIE_SECRET: secret,
          PLAYBACK_DISABLED: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const proc = child;
    const ready = new Promise<void>((ok, fail) => {
      const drain = async (
        stream: ReadableStream<Uint8Array>,
        watchReady: boolean,
      ) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (watchReady) {
                fail(new Error(`Server exited before ready: ${output}`));
              }
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            output += chunk;
            pending += chunk;
            for (
              let end = pending.indexOf("\n");
              end !== -1;
              end = pending.indexOf("\n")
            ) {
              const line = pending.slice(0, end).trim();
              pending = pending.slice(end + 1);
              const match = /^JUKEBOX_READY ([1-9]\d*)$/.exec(line);
              if (watchReady && match) {
                base = `http://127.0.0.1:${match[1]}`;
                ok();
              }
            }
          }
        } catch (error) {
          if (watchReady) fail(error);
        }
      };
      void drain(proc.stdout as ReadableStream<Uint8Array>, true);
      void drain(proc.stderr as ReadableStream<Uint8Array>, false);
      void proc.exited.then((code) => {
        if (code !== 0) {
          fail(new Error(`Server exited ${code}: ${output}`));
        }
      });
    });
    await bounded(ready, `server ready (${output})`);
  };
  const stopServer = async () => {
    if (!child) return;
    child.kill();
    try {
      await bounded(child.exited, "server shutdown", 3000);
    } catch {
      child.kill("SIGKILL");
      await bounded(child.exited, "forced shutdown", 3000);
    }
    child = undefined;
  };
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
    admin = false,
  ) => {
    const response = await bounded(
      fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(admin ? { "x-admin-token": token } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      `${method} ${path}`,
    );
    const data = (await response.json()) as ApiData;
    return { response, data };
  };
  const check = async (
    path: string,
    method: string,
    body: unknown,
    status: number,
    cookie?: string,
    admin = false,
  ) => {
    const result = await call(path, method, body, cookie, admin);
    assert.equal(
      result.response.status,
      method === "POST" && status === 200 ? 201 : status,
      `${method} ${path}: ${JSON.stringify(result.data)}`,
    );
    return result;
  };
  const state = async (cookie?: string): Promise<State> => {
    const result = await call("/api/state", "GET", undefined, cookie);
    assert.equal(result.response.status, 200);
    assert.equal(
      JSON.stringify(result.data).includes("deviceId"),
      false,
      "state exposed deviceId",
    );
    return result.data as unknown as State;
  };
  const bootstrap = async (table: Table) => {
    const url = new URL(table.url);
    const result = await call(
      `/api/table?t=${table.id}&k=${encodeURIComponent(
        url.searchParams.get("k") ?? "",
      )}`,
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.tableId, table.id);
    const cookie = result.response.headers
      .getSetCookie()
      .find((item) => item.startsWith("bj_did="))
      ?.split(";")[0];
    assert.match(cookie ?? "", /^bj_did=[0-9a-f-]{36}\.[\w-]+$/);
    assert.equal(JSON.stringify(result.data).includes("deviceId"), false);
    return {
      cookie: cookie as string,
      secret: url.searchParams.get("k") as string,
    };
  };
  try {
    await spawnServer();
    await check("/api/admin/tables", "POST", { label: "unauthorized" }, 401);
    const wrongToken = await bounded(
      fetch(`${base}/api/admin/tables`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": "wrong",
        },
        body: JSON.stringify({ label: "wrong token" }),
      }),
      "wrong admin token",
    );
    assert.equal(wrongToken.status, 401);
    const created = await check(
      "/api/admin/tables",
      "POST",
      { label: "Fixture Table" },
      200,
      undefined,
      true,
    );
    assert.equal(created.data.ok, true);
    const table = created.data.table as Table;
    assert(table.url && table.id > 0);
    const a = await bootstrap(table);
    const b = await bootstrap(table);
    assert.notEqual(a.cookie, b.cookie);
    await check("/api/table?t=0&k=wrong", "GET", undefined, 403);
    const search = await check("/api/search?q=fixture", "GET", undefined, 200);
    assert.equal(search.data.hits.length, 6);
    const hit = search.data.hits[0];
    assert(hit);
    assert.equal(hit.trackName, "Fixture Song 101");
    const request = (id: number, cookie: string, extra: object = {}) =>
      check(
        "/api/request",
        "POST",
        {
          trackId: id,
          tableId: table.id,
          tableSecret: a.secret,
          ...extra,
        },
        200,
        cookie,
      );
    await check(
      "/api/request",
      "POST",
      {
        trackId: 101,
        tableId: table.id,
        tableSecret: a.secret,
        trackName: "INJECTED",
        artistName: "INJECTED",
        albumUrl: "music://evil",
        artworkUrl: "https://evil",
        trackNumber: 99,
        durationSec: 1,
        deviceId: "spoofed",
        isStaff: true,
      },
      400,
      a.cookie,
    );
    const canonical = await request(101, a.cookie);
    const first = canonical.data.song as Song;
    assert.equal(first.trackName, "Fixture Song 101");
    assert.equal(first.artistName, "Fixture Artist 0");
    assert.equal(
      first.albumUrl,
      "music://music.apple.com/us/album/fixture/id900",
    );
    assert.equal(
      first.artworkUrl,
      "https://is1-ssl.mzstatic.com/image/300x300bb.jpg",
    );
    assert.equal(first.trackNumber, 1);
    assert.equal(first.durationSec, 180);
    assert.equal(first.isStaff, false);
    assert.equal(
      JSON.stringify(canonical.data).includes("deviceId"),
      false,
      "request exposed deviceId",
    );
    await check(
      "/api/request",
      "POST",
      { trackId: 999, tableId: table.id, tableSecret: a.secret },
      400,
      b.cookie,
    );
    await check(
      "/api/request",
      "POST",
      { trackId: 0, tableId: table.id, tableSecret: a.secret },
      400,
      b.cookie,
    );
    await check(
      "/api/request",
      "POST",
      { trackId: 102, tableId: table.id, tableSecret: "invalid" },
      403,
      b.cookie,
    );
    await check(
      "/api/request",
      "POST",
      { trackId: 102, tableId: table.id, tableSecret: a.secret },
      409,
      a.cookie,
    );
    const second = (await request(102, b.cookie)).data.song as Song;
    assert.equal(
      (await state(a.cookie)).queue.find((s) => s.id === first.id)?.isMine,
      true,
    );
    assert.equal(
      (await state(a.cookie)).queue.find((s) => s.id === second.id)?.isMine,
      false,
    );
    assert.equal(
      (await state(b.cookie)).queue.find((s) => s.id === second.id)?.isMine,
      true,
    );
    assert.equal(
      (await state()).queue.every((s) => !s.isMine),
      true,
    );
    const spoof = a.cookie.replace(/^(bj_did=)[^.]+/, `$1${randomUUID()}`);
    const tamper = a.cookie.slice(0, -1) + (a.cookie.endsWith("x") ? "y" : "x");
    for (const cookie of [b.cookie, spoof, tamper, `bj_did=${randomUUID()}`]) {
      assert.equal(
        (await check("/api/cancel", "POST", { id: first.id }, 200, cookie)).data
          .ok,
        false,
      );
    }
    assert.equal((await state(a.cookie)).queue.length, 2);
    const baseline = await state(a.cookie);
    await check(
      "/api/admin/settings",
      "POST",
      { requestsPaused: true, notice: "x".repeat(201) },
      400,
      undefined,
      true,
    );
    assert.equal(
      (await state(a.cookie)).requestsPaused,
      baseline.requestsPaused,
    );
    assert.equal((await state(a.cookie)).notice, baseline.notice);
    await check(
      "/api/admin/settings",
      "POST",
      { maxPerDevice: 2, maxPerTable: 2 },
      200,
      undefined,
      true,
    );
    await check(
      "/api/request",
      "POST",
      { trackId: 103, tableId: table.id, tableSecret: a.secret },
      409,
      b.cookie,
    );
    await check(
      "/api/admin/settings",
      "POST",
      { maxPerTable: 3 },
      200,
      undefined,
      true,
    );
    const contenders = await Promise.all(
      [103, 106].map((trackId) =>
        call(
          "/api/request",
          "POST",
          { trackId, tableId: table.id, tableSecret: a.secret },
          b.cookie,
        ),
      ),
    );
    assert.deepEqual(
      contenders.map((result) => result.response.status).sort(),
      [201, 409],
    );
    const third = contenders.find((result) => result.response.status === 201)
      ?.data.song;
    assert(third);
    const staff = (
      await check(
        "/api/admin/add",
        "POST",
        { trackId: 104 },
        200,
        undefined,
        true,
      )
    ).data.song as Song;
    assert.equal(staff.trackName, "Fixture Song 104");
    const ids = [first.id, second.id, third.id, staff.id];
    assert.deepEqual(
      (await state()).queue.map((s) => s.id),
      ids,
    );
    assert.equal(
      (
        await check(
          "/api/admin/remove",
          "POST",
          { id: second.id },
          200,
          undefined,
          true,
        )
      ).data.ok,
      true,
    );
    const restored = (
      await check(
        "/api/admin/add",
        "POST",
        { trackId: 105 },
        200,
        undefined,
        true,
      )
    ).data.song as Song;
    const beforeReorder = [first.id, third.id, staff.id, restored.id];
    await stopServer();
    await spawnServer();
    assert.deepEqual(
      (await state()).queue.map((song) => song.id),
      beforeReorder,
      "removal and insertion changed restored FIFO order",
    );
    const reordered = [staff.id, third.id, first.id, restored.id];
    await check(
      "/api/admin/reorder",
      "POST",
      { ids: reordered },
      200,
      undefined,
      true,
    );
    assert.deepEqual(
      (await state()).queue.map((s) => s.id),
      reordered,
    );
    await stopServer();
    await spawnServer();
    assert.deepEqual(
      (await state()).queue.map((s) => s.id),
      reordered,
      "queue order not persisted across restart",
    );
    assert.equal((await state()).maxPerTable, 3);
    assert.equal(
      (await check("/api/cancel", "POST", { id: first.id }, 200, a.cookie)).data
        .ok,
      true,
    );
    assert.equal(
      (await state(a.cookie)).queue.some((s) => s.id === first.id),
      false,
    );
    const controller = new AbortController();
    const stream = await bounded(
      fetch(`${base}/api/events`, {
        headers: { Cookie: b.cookie },
        signal: controller.signal,
      }),
      "SSE connect",
    );
    assert.equal(stream.status, 200);
    assert(stream.body);
    const reader = stream.body.getReader();
    let buffer = "";
    const nextState = async (): Promise<State> => {
      while (true) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const frame = buffer.slice(0, end).replace(/\r/g, "");
          buffer = buffer.slice(end + 2);
          if (!frame.includes("event: state")) continue;
          const payload = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          const parsed = JSON.parse(payload) as State;
          assert.equal(
            JSON.stringify(parsed).includes("deviceId"),
            false,
            "SSE exposed deviceId",
          );
          return parsed;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE closed before state");
        buffer = (buffer + new TextDecoder().decode(chunk.value)).replace(
          /\r\n/g,
          "\n",
        );
      }
    };
    try {
      const initial = await bounded(nextState(), "SSE initial state");
      assert.equal(initial.queue.find((s) => s.id === third.id)?.isMine, true);
      assert.equal(initial.queue.find((s) => s.id === staff.id)?.isMine, false);
      const update = bounded(nextState(), "SSE update");
      await check(
        "/api/admin/settings",
        "POST",
        { notice: "SSE changed" },
        200,
        undefined,
        true,
      );
      assert.equal((await update).notice, "SSE changed");
    } finally {
      controller.abort();
      await reader.cancel().catch((error) => {
        if (!controller.signal.aborted) throw error;
      });
    }
    console.log(
      "Isolated API flow passed (auth, cookies, metadata, limits, persistence, SSE).",
    );
  } catch (error) {
    console.error("Isolated API flow failed; server output:\n", output);
    throw error;
  } finally {
    await stopServer();
    await rm(directory, { recursive: true, force: true });
  }
}

await run();
