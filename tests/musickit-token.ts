import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startServerProcess } from "./support/server-process";

export const musickitScenarios = [
  "musickit-token-boundary",
  "musickit-missing-token",
] as const;
const developerToken = [
  Buffer.from(
    JSON.stringify({ alg: "ES256", kid: "qa-not-a-real-key" }),
  ).toString("base64url"),
  Buffer.from(
    JSON.stringify({
      iss: "qa-not-a-real-issuer",
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url"),
  Buffer.alloc(64, 1).toString("base64url"),
].join(".");
const expiredToken = [
  developerToken.split(".")[0],
  Buffer.from(
    JSON.stringify({ iss: "qa-not-a-real-issuer", iat: 1, exp: 2 }),
  ).toString("base64url"),
  developerToken.split(".")[2],
].join(".");
const headers = { "x-admin-token": "qa-local-only" };
const receipts: unknown[] = [];

async function runCase(
  scenario: string,
  kind: string,
  token: string | undefined,
  wrongMode = false,
) {
  const server = await startServerProcess({
    command: [process.execPath, resolve("dist/server/main.js")],
    env: {
      ...process.env,
      PORT: "0",
      DATABASE_URL: ":memory:",
      ADMIN_TOKEN: "qa-local-only",
      DEVICE_COOKIE_SECRET: "qa-local-only",
      BASE_URL: "http://127.0.0.1",
      MUSIC_PROVIDER: "apple-music",
      MUSIC_PLAYBACK_MODE: wrongMode ? "applescript" : "musickit",
      // 비선택 토큰 경계 검증에서도 실제 Music.app은 실행하지 않아요.
      PLAYBACK_DISABLED: wrongMode ? "1" : undefined,
      MUSICKIT_DEVELOPER_TOKEN: token,
    },
  });
  const responses: unknown[] = [];
  const request = async (
    path: string,
    authenticated = false,
    init: RequestInit = {},
  ) => {
    const response = await fetch(`${server.url}${path}`, {
      headers: authenticated ? headers : {},
      signal: AbortSignal.timeout(5000),
      ...init,
    });
    const text = await response.text();
    if (
      path !== "/api/admin/music/developer-token" ||
      !authenticated ||
      wrongMode ||
      kind !== "supplied"
    ) {
      for (const secret of [developerToken, expiredToken, token]) {
        if (secret)
          assert(!text.includes(secret), "비밀이 공개 응답에 노출됐어요");
      }
    }
    responses.push({
      path,
      method: init.method ?? "GET",
      authenticated,
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
      body:
        path === "/" || path.startsWith("/admin/")
          ? {
              bytes: Buffer.byteLength(text),
              sha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
              secretFree: true,
            }
          : text
              .replaceAll(developerToken, "[REDACTED]")
              .replaceAll(expiredToken, "[REDACTED]"),
    });
    return { response, text };
  };
  let completed = false;
  try {
    const unauthorized = await request("/api/admin/music/developer-token");
    assert.equal(unauthorized.response.status, 401);
    const wrongAdmin = await request(
      "/api/admin/music/developer-token",
      false,
      {
        headers: { "x-admin-token": "not-the-admin" },
      },
    );
    assert.equal(wrongAdmin.response.status, 401);
    const authorized = await request("/api/admin/music/developer-token", true);
    assert.equal(authorized.response.headers.get("cache-control"), "no-store");
    assert.equal(
      authorized.response.status,
      wrongMode ? 404 : kind === "supplied" ? 200 : 503,
    );
    const body = JSON.parse(authorized.text);
    if (!wrongMode && kind === "supplied") {
      assert(
        body.developerToken === developerToken,
        "요청한 토큰과 응답이 달라요",
      );
    } else {
      assert.equal(
        body.error.code,
        wrongMode ? "unsupported" : "configuration",
      );
      assert.equal(
        body.readiness,
        wrongMode ? "unavailable" : "setup-required",
      );
    }
    const state = JSON.parse((await request("/api/admin/music", true)).text);
    assert.deepEqual(state.active, {
      providerId: "apple-music",
      modeId: wrongMode ? "applescript" : "musickit",
    });
    assert.equal(state.owner, null);
    assert.equal(state.connectedTarget, null);
    assert.deepEqual(state.locks, { providerId: true, modeId: true });
    assert.deepEqual(state.activeSources, {
      providerId: "environment",
      modeId: "environment",
    });
    if (!wrongMode) {
      assert.equal(state.readiness, "auth-required");
      assert.equal(state.auth.authorization, "none");
      assert.equal(state.auth.status, "reauth-required");
      assert.equal(state.auth.action.kind, "user-gesture");
      assert.equal(state.reason, state.auth.action.label);
      assert.equal(
        (
          await request("/api/admin/music/auth/connect", false, {
            method: "POST",
          })
        ).response.status,
        401,
      );
      assert.equal(
        (
          await request("/api/admin/music/auth/connect", true, {
            method: "POST",
          })
        ).response.status,
        409,
      );
      const configure = (config: unknown, authenticated = true) =>
        request("/api/admin/music/config", authenticated, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authenticated ? headers : {}),
          },
          body: JSON.stringify(config),
        });
      assert.equal((await configure(state.active, false)).response.status, 401);
      assert.equal(
        (await configure({ providerId: 42, modeId: [] })).response.status,
        400,
      );
      assert.equal(
        (
          await configure({
            providerId: "apple-music",
            modeId: "applescript",
          })
        ).response.status,
        409,
      );
      const saved = await configure(state.active);
      assert.equal(saved.response.status, 201);
      const after = JSON.parse(saved.text);
      assert.deepEqual(after.active, state.active);
      assert.deepEqual(after.nextBoot.config, state.active);
      assert.equal(after.restartRequired, false);
      assert.equal(after.owner, null);
      assert.equal(after.auth.authorization, "none");
      assert.equal(after.readiness, "auth-required");
      assert.equal(
        (await request("/api/admin/music/developer-token", true)).response
          .status,
        kind === "supplied" ? 200 : 503,
      );
    }
    for (const path of ["/", "/admin/music", "/admin/qr", "/api/state"]) {
      assert.equal((await request(path)).response.status, 200);
    }
    const controller = new AbortController();
    const stream = await fetch(`${server.url}/api/events`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    let event = "";
    try {
      while (!event.includes("\n\n")) {
        const next = await reader.read();
        assert(!next.done, "첫 SSE 상태 전에 스트림이 닫혔어요");
        event += new TextDecoder().decode(next.value);
      }
      assert(event.includes("event: state"));
      assert(!event.includes(developerToken));
      assert(!event.includes(expiredToken));
      responses.push({
        path: "/api/events",
        status: stream.status,
        body: event,
      });
    } finally {
      try {
        await reader.cancel();
      } finally {
        controller.abort();
      }
    }
    assert(!server.output.includes(developerToken));
    assert(!server.output.includes(expiredToken));
    completed = true;
  } finally {
    await server.stop();
    assert(!server.output.includes(developerToken));
    assert(!server.output.includes(expiredToken));
    if (token) assert(!server.output.includes(token));
    await assert.rejects(
      fetch(`${server.url}/api/state`, { signal: AbortSignal.timeout(1000) }),
    );
    receipts.push({
      scenario,
      kind,
      url: server.url,
      database: ":memory:",
      entry: "dist/server/main.js",
      runtimeInjection: false,
      assertions: completed ? "PASS" : "FAIL",
      responses,
      cleanup: { processStopped: true, portClosed: true },
    });
  }
}

export async function runMusicKitScenario(
  scenario: (typeof musickitScenarios)[number],
) {
  receipts.length = 0;
  try {
    if (scenario === "musickit-token-boundary") {
      await runCase(scenario, "supplied", developerToken);
      await runCase(scenario, "wrong-mode", developerToken, true);
    } else {
      await runCase(scenario, "absent", undefined);
      await runCase(scenario, "expired", expiredToken);
      await runCase(scenario, "malformed", "not-a-token");
    }
    console.info(
      JSON.stringify(
        {
          result: "PASS",
          scenario,
          proof:
            "live-local-http-env-only-production-boot; token-shape-fixture-not-Apple-authentication",
          receipts,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({ result: "FAIL", scenario, receipts }, null, 2),
    );
    throw error;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (
    args.length &&
    (args.length !== 2 ||
      args[0] !== "--scenario" ||
      !musickitScenarios.some((id) => id === args[1]))
  ) {
    console.error(
      JSON.stringify({ error: "unknown-scenario", scenario: args[1] ?? null }),
    );
    process.exit(1);
  }
  for (const scenario of musickitScenarios) {
    if (!args.length || scenario === args[1])
      await runMusicKitScenario(scenario);
  }
}
