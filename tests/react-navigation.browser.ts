import { strict as assert } from "node:assert";
import {
  armCondition,
  expectCondition,
  lifecycleProbe,
} from "./support/browser-lifecycle";
import { createIsolatedServer } from "./support/isolated-server";

await using server = await createIsolatedServer();
const baseUrl = server.url;
const token = server.token;

await using browser = new Bun.WebView({
  backend: { type: "chrome", url: false },
  width: 1440,
  height: 900,
});
await browser.navigate(`${baseUrl}/admin/songs`);
await browser.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: lifecycleProbe,
});
await browser.navigate(`${baseUrl}/admin/songs`);
await browser.evaluate(
  `localStorage.setItem("bj_admin", ${JSON.stringify(token)})`,
);
await browser.navigate(`${baseUrl}/admin/songs`);

const ready = `new Promise((resolve, reject) => {
  const done = () => document.querySelector("header") && document.querySelector(".reception-status")?.textContent.includes("접수 중");
  if (done()) return resolve(true);
  const observer = new MutationObserver(() => {
    if (done()) { observer.disconnect(); clearTimeout(timeout); resolve(true); }
  });
  const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("관리자 준비 시간 초과")); }, 5000);
  observer.observe(document, { childList: true, subtree: true, characterData: true });
})`;
try {
  await browser.evaluate(ready);
} catch (error) {
  console.error(await browser.evaluate("document.body.innerText"));
  throw error;
}
await browser.evaluate(`(() => {
  window.__initialDocument = document;
  window.__initialHeader = document.querySelector("header");
})()`);

async function move(path: string, action: string) {
  const result = await browser.evaluate(`new Promise((resolve, reject) => {
    const done = () => location.pathname === ${JSON.stringify(path)}
      && document.documentElement.dataset.page === ${JSON.stringify(
        `admin-${path.split("/").at(-1)}`,
      )};
    const observer = new MutationObserver(() => {
      if (done()) {
        observer.disconnect(); clearTimeout(timeout);
        resolve({
          documentSame: window.__initialDocument === document,
          headerSame: window.__initialHeader === document.querySelector("header"),
          active: window.__lifecycle.active,
          opened: window.__lifecycle.opened,
        });
      }
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error("이동 시간 초과")); }, 5000);
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    ${action};
  })`);
  assert.deepEqual(result, {
    documentSame: true,
    headerSame: true,
    active: 1,
    opened: 1,
  });
}

for (let i = 0; i < 20; i++) {
  const path = ["/admin/qr", "/admin/music", "/admin/songs"][i % 3]!;
  await move(path, `document.querySelector('a[href="${path}"]').click()`);
}
await move("/admin/qr", "history.back()");
await move("/admin/music", "history.forward()");

await browser.cdp("Network.enable");
await armCondition(
  browser,
  "window.__lifecycle.errors > 0 && window.__lifecycle.polls === 1",
);
await browser.cdp("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
server.disconnectEvents();
await expectCondition(browser, "연결 장애에서 폴링 하나를 시작해요");

await armCondition(
  browser,
  "window.__lifecycle.states > 1 && window.__lifecycle.polls === 0",
);
await browser.cdp("Network.emulateNetworkConditions", {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await expectCondition(browser, "실제 SSE 재연결 후 폴링을 정리해요");
assert.equal(await browser.evaluate("window.__lifecycle.maxPolls"), 1);

// 다른 origin으로 실제 문서 이동한 뒤 history 복원을 확인해요.
const away = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(
      "<!doctype html><title>외부 페이지</title><p>돌아가기 검증</p>",
      {
        headers: { "Content-Type": "text/html" },
      },
    ),
});
try {
  for (const cacheable of [false, true]) {
    if (cacheable) {
      // 운영 no-store는 유지하고 테스트 프록시의 HTML 헤더만 바꿔요.
      server.enableBfcacheFixture();
      await browser.navigate(`${baseUrl}/admin/songs`);
      await armCondition(
        browser,
        "document.querySelector('header') && window.__lifecycle.states > 0",
      );
      await expectCondition(browser, "캐시 복원용 문서를 준비해요");
      await browser.evaluate(
        "(() => { window.__initialDocument = document; return true; })()",
      );
      await browser.evaluate(
        `window.addEventListener("pageshow", event => {
				void fetch("/__qa/pageshow?persisted=" + event.persisted);
			}, { once: true })`,
      );
    }
    const history = await browser.cdp<{
      currentIndex: number;
      entries: { id: number }[];
    }>("Page.getNavigationHistory");
    const entry = history.entries[history.currentIndex];
    assert(entry);
    await browser.navigate(`http://localhost:${away.port}`);
    if (cacheable) {
      // bfcache 복원은 load가 없으므로 떠나기 전에 구독한 pageshow를 기다려요.
      const shown = server.nextPageShow();
      await browser.cdp("Page.navigateToHistoryEntry", {
        entryId: entry.id,
      });
      assert.equal(await shown, true);
    } else {
      if (!("goBack" in browser) || typeof browser.goBack !== "function") {
        throw new Error("Bun.WebView.goBack을 지원하는 런타임이 필요해요");
      }
      await browser.goBack();
    }
    await armCondition(
      browser,
      "document.querySelector('header') && window.__lifecycle.active === 1 && window.__lifecycle.states > 0",
    );
    await expectCondition(browser, "전체 문서 이동 뒤 관리자 연결을 복구해요");
    if (cacheable) {
      assert.equal(
        await browser.evaluate("window.__lifecycle.lastPersisted"),
        true,
        "테스트 캐시 정책에서 실제 bfcache로 복원돼요",
      );
      assert.equal(
        await browser.evaluate("window.__initialDocument === document"),
        true,
      );
      assert.equal(await browser.evaluate("window.__lifecycle.opened"), 2);
      assert.equal(await browser.evaluate("window.__lifecycle.closed"), 1);
    }
    assert.equal(await browser.evaluate("window.__lifecycle.active"), 1);
    assert.deepEqual(await browser.evaluate("window.__lifecycle.failures"), []);
  }
} finally {
  await away.stop(true);
}
assert.deepEqual(await browser.evaluate("window.__lifecycle.failures"), []);
const created = await fetch(`${baseUrl}/api/admin/tables`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-token": token },
  body: JSON.stringify({ label: "브라우저 회귀" }),
});
assert.equal(created.status, 201);
const table: { table: { url: string } } = await created.json();
await browser.navigate(`${baseUrl}/${new URL(table.table.url).search}`);
await armCondition(
  browser,
  "window.__lifecycle.states > 0 && window.__lifecycle.active === 1",
);
await expectCondition(browser, "게스트도 같은 스토어에서 실제 SSE를 구독해요");
await armCondition(
  browser,
  "window.__lifecycle.lastNotice === '회귀 공지' && document.body.innerText.includes('회귀 공지')",
);
const notice = await fetch(`${baseUrl}/api/admin/settings`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-token": token },
  body: JSON.stringify({ notice: "회귀 공지" }),
});
assert.equal(notice.status, 201);
await expectCondition(browser, "서버 변경이 게스트 화면에 SSE로 반영돼요");
assert.deepEqual(await browser.evaluate("window.__lifecycle.failures"), []);
console.info(
  "관리자 20회 이동·history·SSE 장애 복구·실제 bfcache·게스트 상태 반영 검증 통과",
);
