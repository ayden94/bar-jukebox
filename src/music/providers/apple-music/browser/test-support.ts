import { MusicKitFixture } from "../../../../../tests/support/musickit-sdk-fixture";
import type { MusicResult, PlaybackContext } from "../../../contracts/index";
import { createMusicKitProvider } from "./factory";

export const signal = new AbortController().signal;
export const ref = { providerId: "apple-music", trackId: "123" };
export function value<T>(result: MusicResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
export async function fixture() {
  const sdk = new MusicKitFixture();
  const provider = value(
    await createMusicKitProvider(
      {
        api: async () => Response.json({ developerToken: "test-only-token" }),
      },
      signal,
      async () => sdk.sdk,
    ),
  );
  value(await provider.auth.connect(signal));
  const target = value(
    await provider.runtime.connection.listTargets(signal),
  )[0];
  if (!target) throw new Error("대상이 필요해요.");
  const connected = value(
    await provider.runtime.connection.connect(target.ref, signal),
  );
  const context: PlaybackContext = {
    target: connected.target,
    connectionGeneration: connected.connectionGeneration,
    commandId: "play-1",
    attemptId: "attempt-1",
    executorSessionId: "executor-1",
  };
  return {
    sdk,
    provider,
    context,
    playback: provider.runtime.playback,
    play: () =>
      provider.runtime.playback.execute(
        { type: "play", trackRef: ref, initialState: "playing", context },
        signal,
      ),
  };
}
