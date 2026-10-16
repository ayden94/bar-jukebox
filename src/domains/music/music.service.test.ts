import { expect, test } from "bun:test";
import {
  MusicConfigurationError,
  type MusicRuntimeState,
  MusicService,
} from "./music.service";
import {
  type MusicConfig,
  type MusicRegistration,
  resolveMusicBootConfig,
} from "./music-config";
import {
  firstConfig,
  readyState,
  registry,
  secondConfig,
} from "./test-support";

function boot(
  options: Partial<Parameters<typeof resolveMusicBootConfig>[0]> = {},
) {
  return resolveMusicBootConfig({
    environment: {},
    saved: null,
    legacyDefault: firstConfig,
    registry,
    ...options,
  });
}

test("부팅 설정: 환경 변수는 저장값과 기본값보다 우선하고 필드를 잠가요", () => {
  const result = boot({
    environment: {
      MUSIC_PROVIDER: secondConfig.providerId,
      MUSIC_PLAYBACK_MODE: secondConfig.modeId,
    },
    saved: firstConfig,
  });

  expect(result.active).toEqual(secondConfig);
  expect(result.locks).toEqual({ providerId: true, modeId: true });
  expect(result.sources).toEqual({
    providerId: "environment",
    modeId: "environment",
  });
});

test("부팅 설정: 일부 환경 변수만 지정하면 나머지 필드는 저장값을 써요", () => {
  const result = boot({
    environment: { MUSIC_PROVIDER: secondConfig.providerId },
    saved: secondConfig,
  });

  expect(result.active).toEqual(secondConfig);
  expect(result.locks).toEqual({ providerId: true, modeId: false });
  expect(result.sources.modeId).toBe("saved");
});

test("부팅 설정: 저장한 조합은 기본값보다 우선해요", () => {
  const result = boot({ saved: secondConfig });

  expect(result.active).toEqual(secondConfig);
  expect(result.sources.providerId).toBe("saved");
});

test("부팅 설정: 설정이 없으면 조립에서 제공한 기존 기본값을 써요", () => {
  const result = boot();

  expect(result.active).toEqual(firstConfig);
  expect(result.sources.modeId).toBe("default");
});

test("부팅 설정: 비지원 운영체제의 새 설치에는 기본 재생을 만들지 않아요", () => {
  const result = boot({ legacyDefault: null });

  expect(result.active).toBeNull();
  expect(result.issue).not.toBeNull();
  expect(result.sources).toEqual({ providerId: "unset", modeId: "unset" });
});

test("부팅 설정: 빈 환경 변수는 기본값으로 숨기지 않고 설정 오류로 남겨요", () => {
  const result = boot({ environment: { MUSIC_PROVIDER: "" } });

  expect(result.active).toBeNull();
  expect(result.locks.providerId).toBe(true);
  expect(result.issue).not.toBeNull();
});

test("부팅 설정: 미등록 실행 방식은 저장되어 있어도 지원하지 않아요", () => {
  const result = boot({
    saved: { ...firstConfig, modeId: "future-browser" },
  });

  expect(result.active?.modeId).toBe("future-browser");
  expect(result.issue).not.toBeNull();
});

test("부팅 설정: 조립에서 지원하지 않는 조합은 설정 필요 상태예요", async () => {
  const unavailable: readonly MusicRegistration[] = registry.map((entry) => ({
    ...entry,
    modes: entry.modes.map((mode) => ({
      ...mode,
      available: false,
      unavailableReason: "운영체제에서 실행할 수 없어요.",
    })),
  }));
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: boot({ registry: unavailable }),
      registry: unavailable,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );

  expect((await service.getSnapshot()).readiness).toBe("setup-required");
  expect((await service.getSnapshot()).reason).not.toBeNull();
});

test("설정 저장: 영속화가 끝나기 전에는 다음 시작 설정도 바꾸지 않아요", async () => {
  const entered = Promise.withResolvers<void>();
  const persisted = Promise.withResolvers<void>();
  const service = new MusicService(
    {
      save: async () => {
        entered.resolve();
        await persisted.promise;
      },
    },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );
  const save = service.saveConfig(secondConfig);

  await entered.promise;
  expect((await service.getSnapshot()).nextBoot.config).toEqual(firstConfig);
  persisted.resolve();
  await save;

  expect((await service.getSnapshot()).active).toEqual(firstConfig);
  expect((await service.getSnapshot()).nextBoot.config).toEqual(secondConfig);
  expect((await service.getSnapshot()).restartRequired).toBe(true);
});

test("설정 저장: 실패하면 현재와 다음 설정을 보존하고 다음 저장은 허용해요", async () => {
  let fail = true;
  const service = new MusicService(
    {
      save: async () => {
        if (fail) throw new Error("disk-full");
      },
    },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );

  await expect(service.saveConfig(secondConfig)).rejects.toThrow("disk-full");
  expect((await service.getSnapshot()).nextBoot.config).toEqual(firstConfig);
  fail = false;
  await service.saveConfig(secondConfig);

  expect((await service.getSnapshot()).nextBoot.config).toEqual(secondConfig);
});

test("설정 저장: 동시에 요청하면 저장 순서와 공개 설정 순서가 같아요", async () => {
  const entered = Promise.withResolvers<void>();
  const firstWrite = Promise.withResolvers<void>();
  const writes: MusicConfig[] = [];
  const service = new MusicService(
    {
      save: async (config) => {
        writes.push(config);
        if (writes.length === 1) {
          entered.resolve();
          await firstWrite.promise;
        }
      },
    },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );
  const first = service.saveConfig(secondConfig);
  const second = service.saveConfig(firstConfig);

  await entered.promise;
  expect(writes).toEqual([secondConfig]);
  firstWrite.resolve();
  await Promise.all([first, second]);

  expect(writes).toEqual([secondConfig, firstConfig]);
  expect((await service.getSnapshot()).nextBoot.config).toEqual(firstConfig);
});

test("설정 저장: 환경 변수로 고정한 필드 변경은 영속화 전에 거절해요", async () => {
  let writes = 0;
  const service = new MusicService(
    { save: async () => void writes++ },
    {
      boot: boot({ environment: { MUSIC_PROVIDER: firstConfig.providerId } }),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );

  await expect(service.saveConfig(secondConfig)).rejects.toBeInstanceOf(
    MusicConfigurationError,
  );

  expect(writes).toBe(0);
});

test("설정 저장: 다른 공급자의 실행 방식을 섞으면 영속화 전에 거절해요", async () => {
  let writes = 0;
  const service = new MusicService(
    { save: async () => void writes++ },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );

  await expect(
    service.saveConfig({ ...firstConfig, modeId: secondConfig.modeId }),
  ).rejects.toBeInstanceOf(MusicConfigurationError);

  expect(writes).toBe(0);
});

test("설정 상태: 반환값을 바꿔도 실행 중 고정한 설정이 바뀌지 않아요", async () => {
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  );

  Object.assign((await service.getSnapshot()).active!, secondConfig);

  expect((await service.getSnapshot()).active).toEqual(firstConfig);
});

test("재생 비활성: 런타임이 준비됐다고 해도 ready와 외부 실행을 허용하지 않아요", async () => {
  let connections = 0;
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: boot(),
      registry,
      playbackDisabled: true,
      runtime: {
        getState: () => readyState,
        connectAuth: async () => {
          connections++;
          return { ok: true, value: readyState.auth! };
        },
      },
    },
  );

  const result = await service.connectAuth(new AbortController().signal);

  expect(result.ok).toBe(false);
  expect(connections).toBe(0);
  expect((await service.getSnapshot()).readiness).toBe("disabled");
  expect((await service.getSnapshot()).actions.connectAuth).toBe(false);
});

test("연결 상태: 음악 권한과 owner가 없는 재생 충돌을 별도로 보존해요", async () => {
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: {
        getState: () => ({
          ...readyState,
          readiness: "conflict",
          owner: null,
          reason: "저장된 곡의 공급자가 달라요.",
        }),
      },
    },
  );

  const snapshot = await service.getSnapshot();

  expect(snapshot.readiness).toBe("conflict");
  expect(snapshot.auth?.status).toBe("authorized");
  expect(snapshot.owner).toBeNull();
});

test("기기 연결: 현재 공급자와 다른 target은 조정 서비스에 전달하지 않아요", async () => {
  let connections = 0;
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: {
        getState: () => readyState,
        connectTarget: async () => {
          connections++;
          return { ok: true, value: undefined };
        },
      },
    },
  );

  const result = await service.connectTarget(
    { ...secondConfig, targetId: "other-device" },
    new AbortController().signal,
  );

  expect(result.ok).toBe(false);
  expect(connections).toBe(0);
});

test("음악 상태: 비동기 영속 스냅샷이 끝날 때까지 기다리고 별도 owner 캐시를 만들지 않아요", async () => {
  const entered = Promise.withResolvers<void>();
  const stored = Promise.withResolvers<MusicRuntimeState>();
  let state = stored.promise;
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: boot(),
      registry,
      playbackDisabled: false,
      runtime: {
        getState: async () => {
          entered.resolve();
          return state;
        },
      },
    },
  );
  let completed = false;
  const reading = service.getSnapshot().then((snapshot) => {
    completed = true;
    return snapshot;
  });

  await entered.promise;
  expect(completed).toBe(false);
  stored.resolve(readyState);
  expect((await reading).owner).toEqual(readyState.owner);
  state = Promise.resolve({
    ...readyState,
    readiness: "unavailable",
    owner: null,
  });

  const next = await service.getSnapshot();
  expect(next.owner).toBeNull();
  expect(next.readiness).toBe("unavailable");
});
