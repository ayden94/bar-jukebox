import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MusicRepository } from "../src/domains/music/music.repository";
import { createDatabase, initDatabase } from "../src/infra/db";
import { armCondition, expectCondition } from "./support/browser-lifecycle";
import { startServerProcess } from "./support/server-process";

// sdk-script는 실제 Apple CDN에 접근하는 수동 gate예요. CI는 policy-headers를 실행해요.
const scenarios = ["policy-headers", "sdk-script"] as const;
const args = process.argv.slice(2);
if (
  args.length !== 2 ||
  args[0] !== "--scenario" ||
  !scenarios.some((scenario) => scenario === args[1])
) {
  throw new Error(
    `--scenario policy-headers 또는 sdk-script가 필요해요: ${args}`,
  );
}
const scenario = args[1]!;
const evidence = resolve(
  ".omo/evidence/boot-selected-music-playback/task-13-csp",
);
const sdk = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
const token = "csp-qa-local-only";
const headers = { "Content-Type": "application/json", "x-admin-token": token };
const receipts: unknown[] = [];
await mkdir(evidence, { recursive: true });

async function withServer(
  modeId: string,
  run: (
    server: Awaited<ReturnType<typeof startServerProcess>>,
    restart: () => Promise<Awaited<ReturnType<typeof startServerProcess>>>,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "jukebox-csp-"));
  const databaseUrl = `file:${join(directory, "csp.sqlite")}`;
  let server: Awaited<ReturnType<typeof startServerProcess>> | undefined;
  const urls: string[] = [];
  try {
    const connection = createDatabase(databaseUrl);
    try {
      await initDatabase(connection);
      await new MusicRepository(connection.database).save({
        providerId:
          modeId === "browser-companion" ? "youtube-music" : "apple-music",
        modeId,
      });
    } finally {
      connection.client.close();
    }
    const start = async () => {
      const started = await startServerProcess({
        command: [process.execPath, resolve("dist/server/main.js")],
        env: {
          ...process.env,
          PORT: "0",
          BASE_URL: "http://127.0.0.1",
          DATABASE_URL: databaseUrl,
          ADMIN_TOKEN: token,
          DEVICE_COOKIE_SECRET: token,
          MUSIC_PROVIDER: undefined,
          MUSIC_PLAYBACK_MODE: undefined,
          MUSICKIT_DEVELOPER_TOKEN: "",
          // 실제 Music.app을 건드리지 않지만 MusicKit의 토큰 부재는 그대로 검증해요.
          PLAYBACK_DISABLED: modeId === "applescript" ? "1" : "0",
        },
      });
      urls.push(started.url);
      return started;
    };
    server = await start();
    await run(server, async () => {
      await server!.stop();
      server = await start();
      return server;
    });
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(access(directory));
    for (const url of new Set(urls)) {
      await assert.rejects(
        fetch(`${url}/api/state`, { signal: AbortSignal.timeout(1000) }),
      );
    }
    receipts.push({
      cleanup: {
        urls,
        directory,
        processExited: true,
        portsClosed: true,
        directoryRemoved: true,
      },
    });
  }
}

async function checkPolicy(url: string, musickit: boolean) {
  const response = await fetch(`${url}/admin/music`);
  const html = await response.text();
  const policy = response.headers.get("content-security-policy");
  receipts.push({
    request: `GET ${url}/admin/music`,
    status: response.status,
    headers: Object.fromEntries(
      [...response.headers].filter(([name]) => name !== "set-cookie"),
    ),
    htmlSha256: createHash("sha256").update(html).digest("hex"),
  });
  assert.equal(response.status, 200);
  assert(policy);
  const directives = new Map(
    policy
      .split(";")
      .filter((part) => part.trim())
      .map((part) => {
        const [name, ...sources] = part.trim().split(/\s+/);
        return [name!, sources];
      }),
  );
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  assert.deepEqual(directives.get("img-src"), ["'self'", "data:"]);
  assert.deepEqual(directives.get("style-src"), ["'self'", "'unsafe-inline'"]);
  const scripts = directives.get("script-src")!;
  assert.deepEqual(
    scripts.filter((source) => !source.startsWith("'sha256-")),
    ["'self'", ...(musickit ? ["https://js-cdn.music.apple.com"] : [])],
  );
  const inline = [
    ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
  ].filter(
    ([, attributes, source]) =>
      source && !/\bsrc=|type="application\/json"/.test(attributes!),
  );
  assert(inline.length >= 1, "고정 theme script가 있어요");
  assert.match(html, /<script[^>]*type="module"[^>]*src="\/assets\//);
  for (const [, , source] of inline) {
    const hash = createHash("sha256").update(source!).digest("base64");
    assert(
      scripts.includes(`'sha256-${hash}'`),
      "실제 inline script hash가 보존돼요",
    );
  }
  assert.deepEqual(directives.get("connect-src") ?? ["'self'"], [
    "'self'",
    ...(musickit
      ? [
          "https://api.music.apple.com",
          "https://play.itunes.apple.com",
          "https://play-edge.itunes.apple.com",
          "https://universal-activity-service.itunes.apple.com",
        ]
      : []),
  ]);
  assert.deepEqual(directives.get("media-src") ?? ["'self'"], [
    "'self'",
    ...(musickit ? ["blob:"] : []),
  ]);
  assert.deepEqual(directives.get("frame-src") ?? ["'self'"], ["'self'"]);
  // worker-src 생략 시 script-src로 fallback해서 Apple worker까지 허용하면 안 돼요.
  assert.deepEqual(
    directives.get("worker-src") ??
      directives.get("child-src") ??
      scripts.filter((source) => !source.startsWith("'sha256-")),
    ["'self'"],
  );
  assert(!policy.includes("*") && !policy.includes("'unsafe-eval'"));
  assert(!policy.includes(token) && !html.includes(token));
  return policy;
}

async function policyHeaders() {
  for (const mode of [
    "musickit",
    "applescript",
    "invalid-mode",
    "browser-companion",
  ]) {
    await withServer(mode, async (server, restart) => {
      const policy = await checkPolicy(server.url, mode === "musickit");
      const before = await fetch(`${server.url}/api/admin/music`, {
        headers,
      }).then((r) => r.json());
      assert.equal(before.owner, null);
      if (mode === "musickit") {
        assert.deepEqual(before.active, {
          providerId: "apple-music",
          modeId: mode,
        });
        const missing = await fetch(
          `${server.url}/api/admin/music/developer-token`,
          { headers },
        );
        assert.equal(missing.status, 503);
        receipts.push({
          mode,
          missingTokenStatus: missing.status,
          owner: before.owner,
        });
      }
      if (mode !== "applescript") return;
      const saved = await fetch(`${server.url}/api/admin/music/config`, {
        method: "POST",
        headers,
        body: JSON.stringify({ providerId: "apple-music", modeId: "musickit" }),
      });
      assert.equal(saved.status, 201);
      const next = await saved.json();
      assert.deepEqual(next.active, before.active);
      assert.equal(next.nextBoot.config.modeId, "musickit");
      assert.equal(next.restartRequired, true);
      assert.equal(await checkPolicy(server.url, false), policy);
      const restarted = await restart();
      await checkPolicy(restarted.url, true);
      receipts.push({
        saveStatus: saved.status,
        savedNextBoot: next.nextBoot.config,
        activeBeforeRestart: next.active,
        policyChangedOnlyAfterRestart: true,
      });
    });
  }
}

type ScriptResult = {
  loaded: boolean;
  errored: boolean;
  configureType: string;
  violations: {
    blockedURI: string;
    effectiveDirective: string;
    disposition: string;
  }[];
};

async function probeScript(
  view: Bun.WebView,
  source: string,
  allowed: boolean,
) {
  // load/error/violation 구독이 append보다 앞서며, 차단은 error와 실제 CSP 이벤트를 모두 요구해요.
  const result =
    await view.evaluate<ScriptResult>(`new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const result = { loaded: false, errored: false, violations: [], configureType: "undefined" };
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("securitypolicyviolation", violation);
      script.removeEventListener("load", load);
      script.removeEventListener("error", error);
      script.remove();
    };
    const check = () => {
      if (result.loaded || (result.errored && result.violations.length)) {
        result.configureType = typeof window.MusicKit?.configure;
        cleanup(); resolve(result);
      }
    };
    const violation = event => {
      if (event.blockedURI === ${JSON.stringify(source)} || event.blockedURI === ${JSON.stringify(new URL(source).origin)}) {
        result.violations.push({ blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective, disposition: event.disposition });
        check();
      }
    };
    const load = () => { result.loaded = true; check(); };
    const error = () => { result.errored = true; check(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("SDK/CSP 이벤트 시간 초과: " + JSON.stringify(result))); }, 20000);
    document.addEventListener("securitypolicyviolation", violation);
    script.addEventListener("load", load);
    script.addEventListener("error", error);
    script.src = ${JSON.stringify(source)};
    document.head.append(script);
  })`);
  receipts.push({ script: source, expectedAllowed: allowed, ...result });
  assert.equal(result.loaded, allowed);
  assert.equal(result.errored, !allowed);
  if (allowed) {
    assert.equal(result.configureType, "function");
    assert.deepEqual(result.violations, []);
  } else {
    assert(
      result.violations.some(
        (violation) =>
          violation.effectiveDirective === "script-src-elem" &&
          violation.disposition === "enforce",
      ),
    );
  }
}

async function sdkScript() {
  for (const mode of ["musickit", "applescript", "invalid-mode"]) {
    await withServer(mode, async (server) => {
      await checkPolicy(server.url, mode === "musickit");
      const view = new Bun.WebView({
        backend: { type: "chrome", url: false },
        width: 1280,
        height: 900,
      });
      try {
        await view.navigate("about:blank");
        await view.cdp("Page.addScriptToEvaluateOnNewDocument", {
          source: `
          window.__cspQA = { violations: [], errors: [] };
          document.addEventListener("securitypolicyviolation", e => window.__cspQA.violations.push(e.blockedURI));
          window.addEventListener("error", e => window.__cspQA.errors.push(e.message));
          window.addEventListener("unhandledrejection", e => window.__cspQA.errors.push(String(e.reason)));
        `,
        });
        await view.navigate(`${server.url}/admin/music`);
        await armCondition(view, '!!document.querySelector("#admin-password")');
        await expectCondition(view, "관리자 문서가 표시돼요");
        await armCondition(
          view,
          "document.querySelector('button[type=\"submit\"]')?.disabled === false",
        );
        await view.click("#admin-password");
        await view.type(token);
        await expectCondition(
          view,
          "정상 hydration의 React 입력 상태가 갱신돼요",
        );
        assert.deepEqual(await view.evaluate("window.__cspQA"), {
          violations: [],
          errors: [],
        });
        assert.equal(
          await view.evaluate("typeof window.MusicKit"),
          "undefined",
        );
        assert.deepEqual(
          await view.evaluate(
            `performance.getEntriesByType("resource").filter(e => e.name.startsWith("https://js-cdn.music.apple.com/")).map(e => e.name)`,
          ),
          [],
        );
        receipts.push({
          mode,
          browser: await view.cdp("Browser.getVersion"),
          hydration: "PASS",
          automaticSDKRequests: 0,
        });
        await probeScript(view, sdk, mode === "musickit");
        if (mode === "musickit") {
          await probeScript(view, "https://example.com/csp-denied.js", false);
        }
        await Bun.write(
          join(evidence, `${mode}-script.png`),
          await view.screenshot(),
        );
        const snapshot = await fetch(`${server.url}/api/admin/music`, {
          headers,
        }).then((r) => r.json());
        assert.equal(snapshot.owner, null);
        receipts.push({
          mode,
          ownerAfterScriptProbe: snapshot.owner,
          configureAuthorizePlayCalled: false,
        });
      } finally {
        await view[Symbol.asyncDispose]();
        receipts.push({ mode, ownedBrowserClosed: true });
      }
    });
  }
}

let passed = false;
try {
  if (scenario === "policy-headers") await policyHeaders();
  else await sdkScript();
  passed = true;
} finally {
  const result = {
    scenario,
    status: passed ? "PASS" : "FAIL",
    receipts,
    notRun: [
      "MusicKit.configure",
      "Apple authorization",
      "DRM/license",
      "remote media CDN",
      "audio playback",
    ],
  };
  await Bun.write(
    join(evidence, `${scenario}.json`),
    JSON.stringify(result, null, 2),
  );
  console.info(JSON.stringify(result));
}
