import { expect, test } from "bun:test";
import { MusicKitFixture } from "../../../../../tests/support/musickit-sdk-fixture";
import { createMusicKitProvider } from "./factory";
import { signal, value } from "./test-support";

test.each([503, 401])(
  "factory: 토큰 HTTP %s에서는 SDK를 로드하지 않아요",
  async (status) => {
    let loaded = 0;

    const result = await createMusicKitProvider(
      {
        api: async () => Response.json({}, { status }),
      },
      signal,
      async () => {
        loaded++;
        return new MusicKitFixture().sdk;
      },
    );

    expect(result.ok).toBe(false);
    expect(loaded).toBe(0);
  },
);

test.each([null, {}, { developerToken: 1 }, { developerToken: "" }])(
  "factory: 잘못된 토큰 응답 %j는 외부 초기화 전에 거절해요",
  async (body) => {
    let loaded = 0;

    const result = await createMusicKitProvider(
      { api: async () => Response.json(body) },
      signal,
      async () => {
        loaded++;
        return new MusicKitFixture().sdk;
      },
    );

    expect(result).toEqual({ ok: false, error: { code: "configuration" } });
    expect(loaded).toBe(0);
  },
);

test.each(["reject", "cancel"] as const)(
  "인증: %s이면 대상 연결 권한이 없어요",
  async (authorization) => {
    const sdk = new MusicKitFixture();
    sdk.authorization = authorization;
    const provider = value(
      await createMusicKitProvider(
        {
          api: async () => Response.json({ developerToken: "fixture" }),
        },
        signal,
        async () => sdk.sdk,
      ),
    );
    try {
      const result = await provider.auth.connect(signal);

      expect(result.ok).toBe(false);
      expect(provider.auth.getState().authorization).toBe("none");
      expect((await provider.runtime.connection.listTargets(signal)).ok).toBe(
        false,
      );
    } finally {
      await provider.dispose();
    }
    expect(sdk.listenerCount).toBe(0);
  },
);

test("인증: 구독이 없으면 authorized SDK라도 미리 듣기로 연결하지 않아요", async () => {
  const sdk = new MusicKitFixture();
  sdk.subscription = false;
  const provider = value(
    await createMusicKitProvider(
      {
        api: async () => Response.json({ developerToken: "fixture" }),
      },
      signal,
      async () => sdk.sdk,
    ),
  );
  try {
    const result = await provider.auth.connect(signal);

    expect(result).toEqual({ ok: false, error: { code: "permission-denied" } });
    expect(provider.auth.getState().status).toBe("insufficient-permission");
  } finally {
    await provider.dispose();
  }
});

test("인증: 이전 authorized 값이 남아도 authorize 취소를 성공으로 오인하지 않아요", async () => {
  const sdk = new MusicKitFixture();
  sdk.isAuthorized = true;
  sdk.authorization = "cancel";
  const provider = value(
    await createMusicKitProvider(
      {
        api: async () => Response.json({ developerToken: "fixture" }),
      },
      signal,
      async () => sdk.sdk,
    ),
  );
  try {
    const result = await provider.auth.connect(signal);

    expect(result).toEqual({ ok: false, error: { code: "permission-denied" } });
    expect((await provider.runtime.connection.listTargets(signal)).ok).toBe(
      false,
    );
  } finally {
    await provider.dispose();
  }
});

test("취소: 늦은 authorize를 회수하고 재연결에 리스너를 중복하지 않아요", async () => {
  const sdk = new MusicKitFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  sdk.beforeAuthorize = () => {
    entered.resolve();
    return release.promise;
  };
  const provider = value(
    await createMusicKitProvider(
      {
        api: async () => Response.json({ developerToken: "fixture" }),
      },
      signal,
      async () => sdk.sdk,
    ),
  );
  const controller = new AbortController();
  const work = provider.auth.connect(controller.signal);
  await entered.promise;

  controller.abort(new Error("취소"));
  await expect(work).rejects.toThrow("취소");
  const cleanup = provider.dispose();
  expect(sdk.listenerCount).toBe(0);
  release.resolve();
  await cleanup;

  expect(sdk.isAuthorized).toBe(false);
  sdk.beforeAuthorize = null;
  const again = value(
    await createMusicKitProvider(
      {
        api: async () => Response.json({ developerToken: "fixture" }),
      },
      signal,
      async () => sdk.sdk,
    ),
  );
  expect(sdk.listenerCount).toBe(7);
  await again.dispose();
  expect(sdk.listenerCount).toBe(0);
});

test("취소: configure 완료 전 abort는 늦은 singleton도 회수해요", async () => {
  const sdk = new MusicKitFixture();
  const entered = Promise.withResolvers<void>();
  const configured = Promise.withResolvers<unknown>();
  const cleaned = Promise.withResolvers<void>();
  sdk.onChange = () => {
    if (sdk.calls.includes("unauthorize")) cleaned.resolve();
  };
  const controller = new AbortController();
  const work = createMusicKitProvider(
    {
      api: async () => Response.json({ developerToken: "fixture" }),
    },
    controller.signal,
    async () => ({
      ...sdk.sdk,
      configure: () => {
        entered.resolve();
        return configured.promise;
      },
    }),
  );
  await entered.promise;

  controller.abort(new Error("취소"));
  await expect(work).rejects.toThrow("취소");
  configured.resolve(sdk);
  await cleaned.promise;

  expect(sdk.listenerCount).toBe(0);
  expect(sdk.calls).toContain("stop");
});

test("정리: 진행 중 인증의 늦은 완료는 disposed 상태를 되돌리지 않아요", async () => {
  const sdk = new MusicKitFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  sdk.beforeAuthorize = () => {
    entered.resolve();
    return release.promise;
  };
  const provider = value(
    await createMusicKitProvider(
      {
        api: async () => Response.json({ developerToken: "fixture" }),
      },
      signal,
      async () => sdk.sdk,
    ),
  );
  const connecting = provider.auth.connect(signal);
  await entered.promise;

  const closing = provider.dispose();
  await connecting;
  release.resolve();
  await closing;

  expect(provider.auth.getState()).toEqual({
    status: "disconnected",
    authorization: "none",
    action: null,
  });
  expect(sdk.isAuthorized).toBe(false);
  expect(sdk.listenerCount).toBe(0);
});
