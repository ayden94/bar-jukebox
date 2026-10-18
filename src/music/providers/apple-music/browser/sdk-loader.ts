import { isMusicKit, type MusicKitSDK } from "./sdk";

const source = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

// 모듈 import는 DOM/SDK에 접근하지 않아요. 선택된 factory 호출만 이 경계에 와요.
export async function loadMusicKit(signal: AbortSignal): Promise<MusicKitSDK> {
  signal.throwIfAborted();
  const existing: unknown = Reflect.get(globalThis, "MusicKit");
  if (isMusicKit(existing)) return existing;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    const cleanup = () => {
      document.removeEventListener("musickitloaded", loaded);
      signal.removeEventListener("abort", abort);
      script.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("MusicKit SDK를 불러오지 못했어요."));
    };
    const abort = () => {
      cleanup();
      script.remove();
      reject(signal.reason);
    };
    const loaded = () => {
      const sdk: unknown = Reflect.get(globalThis, "MusicKit");
      if (!isMusicKit(sdk)) return failed();
      cleanup();
      resolve(sdk);
    };
    document.addEventListener("musickitloaded", loaded, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    script.addEventListener("error", failed, { once: true });
    document.head.append(script);
  });
}
