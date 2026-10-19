import type {
  BrowserMusicProvider,
  MusicResult,
  ProviderIdentity,
} from "../../src/music/contracts";
import { createContrastingProvider } from "../../src/music/testing/contrasting-provider";
import type { SelectedBrowserFactory } from "../../src/pages/admin/music-registry";

// 이 모듈은 QA Vite 빌드에서만 선택돼요. 제품 bundle에는 포함되지 않아요.
export async function loadBrowserMusicFactory(
  selected: ProviderIdentity,
  signal: AbortSignal,
): Promise<MusicResult<SelectedBrowserFactory>> {
  signal.throwIfAborted();
  if (
    selected.providerId !== "test-radio" ||
    selected.modeId !== "service-player"
  )
    return { ok: false, error: { code: "configuration" } };
  return {
    ok: true,
    value: async (_options, signal) => {
      signal.throwIfAborted();
      const fixture = createContrastingProvider({ location: "browser" });
      const notify = (action: string, detail?: unknown) => {
        window.dispatchEvent(
          new CustomEvent("qa-provider", { detail: { action, detail } }),
        );
      };
      notify("created");
      const provider: BrowserMusicProvider = {
        identity: fixture.provider.identity,
        auth: fixture.provider.auth,
        runtime: {
          connection: fixture.runtime.connection,
          playback: {
            ...fixture.runtime.playback,
            async execute(command, abort) {
              notify("command", command);
              const result = await fixture.runtime.playback.execute(
                command,
                abort,
              );
              // 조정 실행기는 receipt를 전송한 뒤에 관측을 보고해요.
              for (const sequence of fixture.controls.pendingSequences())
                fixture.controls.deliver(sequence);
              return result;
            },
            async *observe(abort) {
              for await (const observation of fixture.runtime.playback.observe(
                abort,
              )) {
                notify("observation", observation);
                yield observation;
              }
            },
          },
        },
        async dispose() {
          await fixture.provider.dispose();
          notify("disposed", { subscribers: fixture.controls.subscriberCount });
        },
      };
      return { ok: true, value: provider };
    },
  };
}
