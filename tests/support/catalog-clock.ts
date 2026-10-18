import { BrowserCatalogBridge as Bridge } from "../../src/domains/music/browser-catalog-bridge";

declare global {
  var catalogQAClockOffset: number | undefined;
}

// QA 빌드에서만 clock 의존성을 바꿔 5분 cursor 만료를 기다리지 않고 확인해요.
export class BrowserCatalogBridge extends Bridge {
  constructor() {
    super({
      now: () => Date.now() + (globalThis.catalogQAClockOffset ?? 0),
      schedule(callback, delay) {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    });
  }
}
