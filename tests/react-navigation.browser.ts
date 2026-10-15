import { strict as assert } from "node:assert";

// 별도 DB와 PLAYBACK_DISABLED=1로 실행한 서버만 사용해요.
const baseUrl = process.env.REACT_TEST_URL;
const token = process.env.REACT_TEST_ADMIN_TOKEN;
if (!baseUrl || !token) {
  throw new Error("REACT_TEST_URL과 REACT_TEST_ADMIN_TOKEN을 설정해주세요");
}

await using browser = new Bun.WebView({
  backend: "chrome",
  width: 1440,
  height: 900,
});
await browser.navigate(`${baseUrl}/admin/songs`);
await browser.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const NativeSource = window.EventSource;
    window.__sources = { opened: 0, closed: 0 };
    window.EventSource = class extends NativeSource {
      constructor(...args) { super(...args); window.__sources.opened++; }
      close() { window.__sources.closed++; super.close(); }
    };
  })();`,
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
        path.endsWith("/qr") ? "admin-qr" : "admin-songs",
      )};
    const observer = new MutationObserver(() => {
      if (done()) {
        observer.disconnect(); clearTimeout(timeout);
        resolve({
          documentSame: window.__initialDocument === document,
          headerSame: window.__initialHeader === document.querySelector("header"),
          sources: window.__sources,
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
    sources: { opened: 1, closed: 0 },
  });
}

for (let i = 0; i < 20; i++) {
  const path = i % 2 === 0 ? "/admin/qr" : "/admin/songs";
  await move(path, `document.querySelector('a[href="${path}"]').click()`);
}
await move("/admin/qr", "history.back()");
await move("/admin/songs", "history.forward()");

assert.deepEqual(
  await browser.evaluate(`(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    const hidden = { ...window.__sources };
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    return { hidden, restored: window.__sources };
  })()`),
  { hidden: { opened: 1, closed: 1 }, restored: { opened: 2, closed: 1 } },
);
console.info(
  "관리자 20회 이동·history·공통 셸·SSE 단일 연결·페이지 복원 검증 통과",
);
