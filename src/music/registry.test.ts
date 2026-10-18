import { expect, test } from "bun:test";
import type { BrowserMusicProvider } from "./contracts";
import {
  loadMusicServer,
  musicDescriptors,
  validateMusicProvider,
} from "./registry";
import { createContrastingProvider } from "./testing";

const options = { platform: "darwin", disabled: true };

test("음악 등록: 세 조합은 인증이나 외부 앱 없이 조회해요", () => {
  const modes = musicDescriptors.flatMap((descriptor) =>
    descriptor.modes.map((mode) => [
      descriptor.providerId,
      mode.modeId,
      mode.location,
    ]),
  );

  expect(modes).toEqual([
    ["apple-music", "applescript", "server"],
    ["apple-music", "musickit", "browser"],
    ["youtube-music", "browser-companion", "browser"],
  ]);
});

test.each([
  { providerId: "apple-music", modeId: "musickit" },
  { providerId: "youtube-music", modeId: "browser-companion" },
])(
  "선택 loader: 미구현 $providerId/$modeId 조합은 준비 성공을 만들지 않아요",
  async (selected) => {
    const result = await loadMusicServer(
      selected,
      options,
      new AbortController().signal,
    );

    expect(result).toEqual({ ok: false, error: { code: "unsupported" } });
  },
);

test.each([
  { providerId: "apple-music", modeId: "browser-companion" },
  { providerId: "youtube-music", modeId: "applescript" },
  { providerId: "", modeId: "applescript" },
  { providerId: "apple-music", modeId: "../../server" },
])(
  "선택 loader: 잘못된 $providerId/$modeId 조합은 기본 방식으로 바꾸지 않아요",
  async (selected) => {
    const result = await loadMusicServer(
      selected,
      options,
      new AbortController().signal,
    );

    expect(result).toEqual({ ok: false, error: { code: "configuration" } });
  },
);

test("선택 loader: 시작 전 반복 취소는 초기화하지 않고 다음 요청과 분리돼요", async () => {
  const selected = { providerId: "apple-music", modeId: "applescript" };
  for (let index = 0; index < 3; index++) {
    const reason = new Error(`취소-${index}`);

    await expect(
      loadMusicServer(selected, options, AbortSignal.abort(reason)),
    ).rejects.toBe(reason);
  }

  const created = await loadMusicServer(
    selected,
    options,
    new AbortController().signal,
  );
  expect(created.ok).toBe(true);
  if (created.ok) {
    expect(created.value.identity).toEqual(selected);
    expect(created.value.auth.getState().status).toBe("disconnected");
    await created.value.dispose();
    await created.value.dispose();
  }
});

test.each(["server", "browser"] as const)(
  "factory 검증: %s 실행 위치와 선택 identity를 허용해요",
  async (location) => {
    const fixture = createContrastingProvider({ location });
    const provider: BrowserMusicProvider | typeof fixture.provider =
      location === "browser"
        ? {
            identity: fixture.provider.identity,
            auth: fixture.provider.auth,
            runtime: fixture.runtime,
            dispose: fixture.provider.dispose,
          }
        : fixture.provider;
    try {
      await validateMusicProvider(
        fixture.descriptor,
        provider.identity,
        provider,
      );

      expect(provider.auth.getState().status).toBe("disconnected");
    } finally {
      await provider.dispose();
    }
  },
);

test.each(["provider", "mode", "location", "capability"] as const)(
  "factory 검증: 브라우저 %s 불일치는 부분 생성 자원을 정리하고 거절해요",
  async (invalid) => {
    const fixture = createContrastingProvider({
      location: invalid === "location" ? "server" : "browser",
      capabilities: { canObserveEnd: invalid !== "capability" },
    });
    let disposals = 0;
    const provider: BrowserMusicProvider = {
      identity: {
        providerId:
          invalid === "provider"
            ? "other"
            : fixture.provider.identity.providerId,
        modeId: invalid === "mode" ? "other" : fixture.provider.identity.modeId,
      },
      auth: fixture.provider.auth,
      runtime: fixture.runtime,
      async dispose() {
        disposals++;
        await fixture.provider.dispose();
      },
    };

    await expect(
      validateMusicProvider(
        fixture.descriptor,
        fixture.provider.identity,
        provider,
      ),
    ).rejects.toThrow();

    expect(disposals).toBe(1);
    expect(fixture.controls.subscriberCount).toBe(0);
  },
);
