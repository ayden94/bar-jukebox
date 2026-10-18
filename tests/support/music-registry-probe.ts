import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { MusicServerOptions } from "../../src/music/registry";
import { createContrastingProvider } from "../../src/music/testing";

// mock은 이 별도 QA 프로세스에만 적용돼요. 제품 번들과 실제 공급자 검증에는 쓰지 않아요.
const calls: string[] = [];
const fixture = createContrastingProvider({
  providerId: "apple-music",
  modeId: "applescript",
});
mock.module("../../src/music/providers/apple-music/server", () => ({
  async createAppleMusicServer(
    options: MusicServerOptions,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    assert.equal(options.disabled, true);
    assert.equal(options.platform, "darwin");
    calls.push("apple-music/applescript");
    return {
      ok: true,
      value: {
        ...fixture.provider,
        artwork: {
          fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
        },
      },
    };
  },
}));

const { loadMusicServer, musicDescriptors } = await import(
  "../../src/music/registry"
);
assert.deepEqual(calls, []);
const rows = [];
try {
  for (const descriptor of musicDescriptors) {
    for (const mode of descriptor.modes) {
      const before = calls.length;
      const selected = {
        providerId: descriptor.providerId,
        modeId: mode.modeId,
      };
      const result = await loadMusicServer(
        selected,
        { platform: "darwin", disabled: true },
        new AbortController().signal,
      );
      const expected = mode.modeId === "applescript";
      assert.equal(result.ok, expected);
      assert.deepEqual(
        calls.slice(before),
        expected ? ["apple-music/applescript"] : [],
      );
      if (!result.ok) assert.equal(result.error.code, "unsupported");
      rows.push({
        selected,
        factoryCalls: calls.slice(before),
        result: result.ok ? "fixture-created" : result.error.code,
      });
    }
  }
  const before = calls.length;
  for (let index = 0; index < 3; index++) {
    const reason = new Error(`취소-${index}`);
    await assert.rejects(
      loadMusicServer(
        fixture.provider.identity,
        { platform: "darwin", disabled: true },
        AbortSignal.abort(reason),
      ),
      (error) => error === reason,
    );
  }
  assert.equal(calls.length, before);
  console.info(
    JSON.stringify({
      scenario: "factory-isolation",
      status: "passed",
      surface: "source-loader-fixture",
      rows,
      assertions: {
        selectedFactoryOnly: true,
        noFactoryOnImport: true,
        unavailableFactoriesNotInvoked: true,
        repeatedCancellation: true,
      },
      liveProviderPlayback: "not-run",
    }),
  );
} finally {
  await fixture.provider.dispose();
  assert.equal(fixture.controls.subscriberCount, 0);
  mock.restore();
}
