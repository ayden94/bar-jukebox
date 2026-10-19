import { MusicKitFixture } from "./musickit-sdk-fixture";

const fixture = new MusicKitFixture();
fixture.onChange = () => window.dispatchEvent(new Event("qa-lifecycle"));
Reflect.set(window, "__musickitQA", fixture);

// Vite QA 모듈 치환에서만 사용해요. production registry/factory/playback은 그대로예요.
export async function loadMusicKit(signal: AbortSignal) {
  signal.throwIfAborted();
  return fixture.sdk;
}
