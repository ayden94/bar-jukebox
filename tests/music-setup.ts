import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { musickitScenarios, runMusicKitScenario } from "./musickit-token";
import { startServerProcess } from "./support/server-process";

const scenarios = [
  "boot-matrix",
  "invalid-mode",
  ...musickitScenarios,
] as const;
type Scenario = (typeof scenarios)[number];
const args = process.argv.slice(2);
if (
  args.length !== 0 &&
  (args.length !== 2 ||
    args[0] !== "--scenario" ||
    !scenarios.some((scenario) => scenario === args[1]))
) {
  console.error(
    JSON.stringify({
      scenario: args[1] ?? null,
      status: "failed",
      error: "알 수 없는 음악 설정 시나리오예요.",
    }),
  );
  process.exit(1);
}
const selectedScenarios: readonly Scenario[] =
  args.length === 0
    ? scenarios
    : scenarios.filter((scenario) => scenario === args[1]);

const token = "qa-local-only";
const headers = { "Content-Type": "application/json", "x-admin-token": token };

async function withServer(
  selected: { providerId: string; modeId: string },
  disabled: boolean,
  run: (
    server: Awaited<ReturnType<typeof startServerProcess>>,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "jukebox-music-setup-"));
  let server: Awaited<ReturnType<typeof startServerProcess>> | undefined;
  try {
    server = await startServerProcess({
      command: [process.execPath, resolve("dist/server/main.js")],
      env: {
        ...process.env,
        // 병렬 QA가 공용 5187 포트를 점유할 수 있어 전용 포트를 할당해요.
        PORT: "0",
        BASE_URL: "http://127.0.0.1",
        DATABASE_URL: `file:${join(directory, "setup.sqlite")}`,
        ADMIN_TOKEN: token,
        DEVICE_COOKIE_SECRET: token,
        MUSIC_PROVIDER: selected.providerId,
        MUSIC_PLAYBACK_MODE: selected.modeId,
        PLAYBACK_DISABLED: disabled ? "1" : undefined,
        MUSICKIT_DEVELOPER_TOKEN: undefined,
      },
    });
    await run(server);
  } catch (error) {
    if (server) console.error(server.output);
    throw error;
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(access(directory));
    if (server) {
      await assert.rejects(
        fetch(`${server.url}/api/state`, { signal: AbortSignal.timeout(1000) }),
      );
    }
    console.info(
      JSON.stringify({
        cleanup: {
          url: server?.url ?? null,
          processExited: true,
          portClosed: server !== undefined,
          directory,
          directoryRemoved: true,
        },
      }),
    );
  }
}

async function bootMatrix() {
  // 별도 프로세스의 factory fixture는 조립 증거이며 실제 공급자 재생 증거가 아니에요.
  const probe = Bun.spawn(
    [process.execPath, resolve("tests/support/music-registry-probe.ts")],
    { stdout: "pipe", stderr: "pipe", env: process.env },
  );
  const timeout = setTimeout(() => probe.kill("SIGKILL"), 10000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      probe.exited,
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
    ]);
    assert.equal(code, 0, stderr);
    const result = JSON.parse(stdout);
    assert.equal(result.status, "passed");
    assert.equal(result.assertions.selectedFactoryOnly, true);
    console.info(JSON.stringify(result));
  } finally {
    clearTimeout(timeout);
    if (probe.exitCode === null) {
      probe.kill("SIGKILL");
      await probe.exited;
    }
  }
  for (const selected of [
    { providerId: "apple-music", modeId: "applescript" },
    { providerId: "apple-music", modeId: "musickit" },
    { providerId: "youtube-music", modeId: "browser-companion" },
  ]) {
    // AppleScript의 외부 앱은 차단하고, 브라우저 방식은 owner 없는 인증 대기를 확인해요.
    const disabled = selected.modeId === "applescript";
    await withServer(selected, disabled, async (server) => {
      const response = await fetch(`${server.url}/api/admin/music`, {
        headers,
      });
      assert.equal(response.status, 200);
      const state = await response.json();
      assert.deepEqual(state.active, selected);
      assert.deepEqual(state.locks, { providerId: true, modeId: true });
      assert.equal(state.owner, null);
      assert.equal(state.connectedTarget, null);
      assert.equal(
        state.readiness,
        disabled
          ? process.platform === "darwin"
            ? "disabled"
            : "setup-required"
          : "auth-required",
      );
      if (!disabled) {
        assert.equal(state.auth.authorization, "none");
        assert.equal(state.auth.status, "reauth-required");
        assert.equal(state.auth.action.kind, "user-gesture");
      }
      assert.equal(state.providers.length, 2);
      assert.equal(
        state.providers.flatMap((entry: { modes: unknown[] }) => entry.modes)
          .length,
        3,
      );
      const page = await fetch(`${server.url}/admin/music`);
      assert.equal(page.status, 200);
      assert((await page.text()).includes("admin-music"));
      const publicState = await (await fetch(`${server.url}/api/state`)).json();
      assert.deepEqual(publicState.queue, []);
      assert.equal(publicState.nowPlaying, null);
      console.info(
        JSON.stringify({
          scenario: "boot-matrix",
          surface: "built-production-http",
          url: server.url,
          active: state.active,
          readiness: state.readiness,
          assertions: {
            activeMatches: true,
            noOwner: true,
            noFallback: true,
            descriptorCount: 3,
            adminSsr: true,
          },
          liveProviderPlayback: "not-run",
        }),
      );
    });
  }
}

async function invalidMode() {
  await withServer(
    { providerId: "unregistered-provider", modeId: "missing-mode" },
    false,
    async (server) => {
      const unauthorized = await fetch(`${server.url}/api/admin/music`);
      assert.equal(unauthorized.status, 401);
      const response = await fetch(`${server.url}/api/admin/music`, {
        headers,
      });
      assert.equal(response.status, 200);
      const state = await response.json();
      assert.equal(state.readiness, "setup-required");
      assert.deepEqual(state.active, {
        providerId: "unregistered-provider",
        modeId: "missing-mode",
      });
      assert.deepEqual(state.locks, { providerId: true, modeId: true });
      assert.equal(state.connectedTarget, null);
      assert.equal(state.owner, null);
      assert(
        Object.values(state.actions).every((allowed) => allowed === false),
      );
      const page = await fetch(`${server.url}/admin/music`);
      assert.equal(page.status, 200);
      assert((await page.text()).includes("admin-music"));
      const changed = await fetch(`${server.url}/api/admin/music/config`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          providerId: "apple-music",
          modeId: "applescript",
        }),
      });
      assert.equal(changed.status, 409);
      const search = await fetch(`${server.url}/api/search?q=fixture`);
      assert.equal(search.status, 500);
      const add = await fetch(`${server.url}/api/admin/add`, {
        method: "POST",
        headers,
        body: JSON.stringify({ providerId: "apple-music", trackId: "101" }),
      });
      assert.equal(add.status, 503);
      const publicState = await (await fetch(`${server.url}/api/state`)).json();
      assert.deepEqual(publicState.queue, []);
      assert.equal(publicState.nowPlaying, null);
      console.info(
        JSON.stringify({
          scenario: "invalid-mode",
          surface: "built-production-http",
          url: server.url,
          response: { status: response.status, state },
          assertions: {
            setupRequired: true,
            noOwner: true,
            noFallback: true,
            envLocked: true,
            unauthorized: 401,
            searchBlocked: 500,
            requestBlocked: 503,
          },
        }),
      );
    },
  );
}

for (const scenario of selectedScenarios) {
  try {
    if (scenario === "boot-matrix") await bootMatrix();
    else if (scenario === "invalid-mode") await invalidMode();
    else await runMusicKitScenario(scenario);
    console.info(JSON.stringify({ scenario, status: "passed" }));
  } catch (error) {
    console.error(JSON.stringify({ scenario, status: "failed" }));
    throw error;
  }
}
