import { strict as assert } from "node:assert";

export const lifecycleProbe = `(() => {
  const stats = window.__lifecycle = {
    opened: 0, closed: 0, active: 0, states: 0, errors: 0,
    polls: 0, maxPolls: 0, lastPersisted: false, lastNotice: null,
    failures: [],
  };
  const signal = () => window.dispatchEvent(new Event("qa-lifecycle"));
  const NativeSource = window.EventSource;
  window.EventSource = class extends NativeSource {
    constructor(...args) {
      super(...args);
      this.closed = false;
      stats.opened++; stats.active++;
      this.addEventListener("state", e => {
        stats.states++;
        stats.lastNotice = JSON.parse(e.data).notice;
        signal();
      });
      this.addEventListener("error", () => { stats.errors++; signal(); });
    }
    close() {
      if (!this.closed) { this.closed = true; stats.closed++; stats.active--; }
      super.close(); signal();
    }
  };
  const intervals = new Set();
  const nativeSet = window.setInterval.bind(window);
  const nativeClear = window.clearInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => {
    const id = nativeSet(callback, delay, ...args);
    if (delay === 3000) {
      intervals.add(id); stats.polls = intervals.size;
      stats.maxPolls = Math.max(stats.maxPolls, stats.polls); signal();
    }
    return id;
  };
  window.clearInterval = id => {
    nativeClear(id); intervals.delete(id); stats.polls = intervals.size; signal();
  };
  window.addEventListener("pageshow", event => {
    stats.lastPersisted = event.persisted; signal();
  });
  window.addEventListener("error", event => stats.failures.push(event.message));
  window.addEventListener("unhandledrejection", event => stats.failures.push(String(event.reason)));
})();`;

// 조건을 먼저 구독한 뒤 호출자가 클릭·네트워크 변경을 실행해요.
export async function armCondition(
  browser: Bun.WebView,
  condition: string,
  timeoutMs = 10000,
) {
  await browser.evaluate(`(() => {
    window.__condition = new Promise(resolve => {
      const finish = ok => {
        clearTimeout(timeout); observer.disconnect();
        window.removeEventListener("qa-lifecycle", check);
        resolve(ok);
      };
      const check = () => { if (${condition}) finish(true); };
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish(false), ${timeoutMs});
      observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
      window.addEventListener("qa-lifecycle", check);
      check();
    });
  })()`);
}

export async function expectCondition(browser: Bun.WebView, label: string) {
  assert.equal(await browser.evaluate("window.__condition"), true, label);
}
