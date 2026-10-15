import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  armCondition,
  expectCondition,
  lifecycleProbe,
} from "./support/browser-lifecycle";
import { createIsolatedServer } from "./support/isolated-server";

const navigationAccept = "application/vnd.fluo.react-navigation+json;v=2";
let navigationStatus = 0;
let failedPath = "/admin/qr";
let apiStatus = 0;
let incompatible: unknown;
let holdSave: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let saveStarted = Promise.withResolvers<void>();
const requests: string[] = [];
await using server = await createIsolatedServer({
  async intercept(request) {
    const path = new URL(request.url).pathname;
    if (request.headers.get("Accept")?.includes(navigationAccept)) {
      requests.push(path);
      if (path === failedPath) {
        if (navigationStatus) {
          return Response.json(
            { error: { message: "fixture" } },
            {
              status: navigationStatus,
            },
          );
        }
        if (incompatible) {
          return Response.json(incompatible, {
            headers: { "Content-Type": navigationAccept },
          });
        }
      }
    }
    if (path.startsWith("/api/admin/")) {
      if (apiStatus) {
        return Response.json(
          { error: { message: "fixture" } },
          {
            status: apiStatus,
          },
        );
      }
      if (path === "/api/admin/settings" && holdSave) {
        saveStarted.resolve();
        await holdSave.promise;
      }
    }
  },
});
await using browser = new Bun.WebView({
  backend: { type: "chrome", url: false },
  width: 1440,
  height: 900,
});
await browser.navigate(`${server.url}/admin/songs`);
await browser.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `${lifecycleProbe}
		window.__alerts = 0;
		window.alert = () => { window.__alerts++; window.dispatchEvent(new Event("qa-lifecycle")); };`,
});
await browser.evaluate(
  `localStorage.setItem("bj_admin", ${JSON.stringify(server.token)})`,
);
await browser.navigate(`${server.url}/admin/songs`);
const ready =
  "document.querySelector('header') && window.__lifecycle.states > 0";
await armCondition(browser, ready);
await expectCondition(browser, "관리자 준비");
await browser.evaluate(
  "(() => { window.__document = document; window.__header = document.querySelector('header'); })()",
);

const errorPanel = 'section[aria-label="페이지 이동 오류"]';
const decisionPanel = 'section[aria-label="페이지 이동 확인"]';
async function clickAndWait(selector: string, condition: string) {
  await browser.scrollTo(selector, { block: "center" });
  await armCondition(browser, condition);
  await browser.click(selector);
  await expectCondition(browser, selector);
}
async function fill(selector: string, value: string) {
  await browser.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(
      value,
    )});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
}
async function assertShell() {
  assert.deepEqual(
    await browser.evaluate(`({
    document: window.__document === document,
    header: window.__header === document.querySelector("header"),
    opened: window.__lifecycle.opened, active: window.__lifecycle.active,
  })`),
    { document: true, header: true, opened: 1, active: 1 },
  );
}
async function capture(name: string) {
  const directory = process.env.QA_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  for (const width of [390, 1440]) {
    await browser.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width === 390,
    });
    for (const theme of ["light", "dark"]) {
      await browser.evaluate(`(() => {
				const select = document.querySelector('select[aria-label="테마 선택"]');
				select.value = '${theme}'; select.dispatchEvent(new Event("change", { bubbles: true }));
			})()`);
      if (name === "unsaved-input") {
        await browser.scrollTo(decisionPanel, { block: "center" });
      }
      await Bun.write(
        join(directory, `${name}-${width}-${theme}.png`),
        await browser.screenshot(),
      );
    }
  }
}
const hasError = `!!document.querySelector('${errorPanel}')`;
const hasDecision = `!!document.querySelector('${decisionPanel}')`;
console.info("network 실패와 재시도");

// 실제 요청 차단은 network 실패이며 자동 문서 이동이 없어야 해요.
await browser.cdp("Network.enable");
await browser.cdp("Network.setBlockedURLs", {
  urls: [`${server.url}/admin/qr*`],
});
await clickAndWait('a[href="/admin/qr"]', hasError);
assert.equal(await browser.evaluate("location.pathname"), "/admin/songs");
await assertShell();
await capture("navigation-error");
await browser.cdp("Network.setBlockedURLs", { urls: [] });
await clickAndWait(
  `${errorPanel} a:first-of-type`,
  "location.pathname === '/admin/qr' && !document.querySelector('section[aria-label=\"페이지 이동 오류\"]')",
);
await assertShell();

// 실패한 back은 마지막 승인 URL로 돌아가고 retry에서만 재승인해요.
console.info("history 실패와 재시도");
navigationStatus = 503;
failedPath = "/admin/songs";
await armCondition(browser, hasError);
await browser.evaluate("history.back()");
await expectCondition(browser, "history 실패");
assert.equal(await browser.evaluate("location.pathname"), "/admin/qr");
await assertShell();
navigationStatus = 0;
await clickAndWait(
  `${errorPanel} a:first-of-type`,
  "location.pathname === '/admin/songs' && !document.querySelector('section[aria-label=\"페이지 이동 오류\"]')",
);

// 빌드 불일치는 자동 reload 대신 명시적인 문서 이동으로 복구해요.
console.info("빌드 불일치와 명시적 문서 이동");
failedPath = "/admin/qr";
const response = await fetch(`${server.url}/admin/qr`, {
  headers: { Accept: navigationAccept },
});
const payload = await response.json();
incompatible = { ...payload, buildId: "different-build" };
await clickAndWait('a[href="/admin/qr"]', hasError);
await assertShell();
incompatible = undefined;
const loaded = Promise.withResolvers<void>();
const loadTimeout = setTimeout(
  () => loaded.reject(new Error("명시적 문서 이동 시간 초과")),
  10000,
);
browser.onNavigated = () => loaded.resolve();
try {
  await browser
    .click(`${errorPanel} a:last-of-type`)
    .catch((error: unknown) => {
      if (
        !(error instanceof Error) ||
        error.message !== "Inspected target navigated or closed"
      ) {
        throw error;
      }
    });
  await loaded.promise;
} finally {
  browser.onNavigated = null;
  clearTimeout(loadTimeout);
}
await armCondition(browser, ready);
await expectCondition(browser, "문서 이동 후 인증 복원");
assert.equal(await browser.evaluate("window.__document === document"), false);
await clickAndWait(
  'a[href="/admin/songs"]',
  "location.pathname === '/admin/songs' && !!document.querySelector('#notice-input')",
);

// 초안과 저장 중 상태는 확인 없이 GET을 보내지 않아요.
console.info("초안과 저장 중 수정 보호");
await fill("#notice-input", "첫 초안");
const beforeGuard = requests.length;
await clickAndWait('a[href="/admin/qr"]', hasDecision);
await capture("unsaved-input");
assert.equal(requests.length, beforeGuard);
assert.equal(
  await browser.evaluate(
    `document.activeElement === document.querySelector('${decisionPanel} button')`,
  ),
  true,
);
await clickAndWait(
  `${decisionPanel} button:first-of-type`,
  `!document.querySelector('${decisionPanel}')`,
);
assert.equal(
  await browser.evaluate("document.querySelector('#notice-input').value"),
  "첫 초안",
);
navigationStatus = 503;
failedPath = "/admin/qr";
await clickAndWait('a[href="/admin/qr"]', hasDecision);
await clickAndWait(`${decisionPanel} button:last-of-type`, hasError);
await clickAndWait(`${errorPanel} a:first-of-type`, hasDecision);
await clickAndWait(
  `${decisionPanel} button:first-of-type`,
  `!document.querySelector('${decisionPanel}')`,
);
await clickAndWait(`${errorPanel} a:first-of-type`, hasDecision);
navigationStatus = 0;
await clickAndWait(
  `${decisionPanel} button:last-of-type`,
  "location.pathname === '/admin/qr'",
);
await clickAndWait(
  'a[href="/admin/songs"]',
  "location.pathname === '/admin/songs' && !!document.querySelector('#notice-input')",
);
await fill("#notice-input", "첫 초안");
apiStatus = 503;
await armCondition(browser, "window.__alerts === 1");
await browser.evaluate(
  "document.querySelector('#notice-input').closest('form').requestSubmit()",
);
await expectCondition(browser, "실패한 저장 뒤 입력 유지");
await armCondition(
  browser,
  "!document.querySelector('#notice-input').closest('form').querySelector('button').disabled",
);
await expectCondition(browser, "실패한 저장 요청 정리");
apiStatus = 0;
assert.equal(
  await browser.evaluate("document.querySelector('#notice-input').value"),
  "첫 초안",
);

holdSave = Promise.withResolvers<void>();
saveStarted = Promise.withResolvers<void>();
await browser.evaluate(
  "document.querySelector('#notice-input').closest('form').requestSubmit()",
);
const saveTimeout = setTimeout(
  () => saveStarted.reject(new Error("저장 요청 시간 초과")),
  10000,
);
try {
  await saveStarted.promise;
} finally {
  clearTimeout(saveTimeout);
}
await fill("#notice-input", "저장 중 새 초안");
await clickAndWait('a[href="/admin/qr"]', hasDecision);
await clickAndWait(
  `${decisionPanel} button:first-of-type`,
  `!document.querySelector('${decisionPanel}')`,
);
await armCondition(browser, "window.__lifecycle.lastNotice === '첫 초안'");
holdSave.resolve();
holdSave = undefined;
await expectCondition(browser, "이전 저장 응답");
assert.equal(
  await browser.evaluate("document.querySelector('#notice-input').value"),
  "저장 중 새 초안",
);
await clickAndWait('a[href="/admin/qr"]', hasDecision);
await clickAndWait(
  `${decisionPanel} button:last-of-type`,
  "location.pathname === '/admin/qr'",
);

await fill('input[placeholder="예: 창가 1번"]', "미완성 테이블");
await clickAndWait('a[href="/admin/songs"]', hasDecision);
// 인증 철회는 입력 확인보다 우선하며 화면과 SSE를 폐기해요.
apiStatus = 401;
await armCondition(
  browser,
  "!!document.querySelector('input[type=\"password\"]') && window.__lifecycle.active === 0",
);
await browser.evaluate(
  "document.querySelector('input[placeholder=\"예: 창가 1번\"]').closest('form').requestSubmit()",
);
await expectCondition(browser, "API 인증 철회");
assert.equal(
  await browser.evaluate(`!!document.querySelector('${decisionPanel}')`),
  false,
);
assert.equal(
  await browser.evaluate("localStorage.getItem('bj_admin') === null"),
  true,
);

apiStatus = 0;
await fill('input[type="password"]', server.token);
const authenticated = Promise.withResolvers<void>();
const authTimeout = setTimeout(
  () => authenticated.reject(new Error("재로그인 시간 초과")),
  10000,
);
browser.onNavigated = () => authenticated.resolve();
try {
  await browser.evaluate(
    "document.querySelector('input[type=\"password\"]').closest('form').requestSubmit()",
  );
  await authenticated.promise;
} finally {
  browser.onNavigated = null;
  clearTimeout(authTimeout);
}
await armCondition(browser, ready);
await expectCondition(browser, "재로그인 후 새 문서");
navigationStatus = 403;
failedPath = "/admin/songs";
await clickAndWait(
  'a[href="/admin/songs"]',
  "!!document.querySelector('input[type=\"password\"]') && window.__lifecycle.active === 0",
);
assert.equal(
  await browser.evaluate("localStorage.getItem('bj_admin') === null"),
  true,
);
assert.deepEqual(await browser.evaluate("window.__lifecycle.failures"), []);
console.info(
  "network·5xx·history·빌드 불일치·재시도·초안·저장 중 수정·401/403 보호 검증 통과",
);
