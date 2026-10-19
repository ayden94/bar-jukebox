import { expect, test } from "bun:test";
import type { MusicResult } from "../../music/contracts";
import { MusicService } from "./music.service";
import { type MusicRegistration, resolveMusicBootConfig } from "./music-config";
import { registry as fixtureRegistry, readyState } from "./test-support";

const selected = { providerId: "apple-music", modeId: "musickit" };
const registry: readonly MusicRegistration[] = [
  {
    descriptor: {
      providerId: "apple-music",
      displayName: "Apple Music",
      modes: ["musickit", "applescript"].map((modeId) => ({
        ...fixtureRegistry[0]!.descriptor.modes[0]!,
        modeId,
        location: modeId === "musickit" ? "browser" : "server",
      })),
    },
    modes: ["musickit", "applescript"].map((modeId) => ({
      modeId,
      displayName: modeId,
      available: true,
      unavailableReason: null,
    })),
  },
];

function fixture(modeId = "musickit", playbackDisabled = false) {
  let reads = 0;
  let result: MusicResult<{ developerToken: string }> = {
    ok: true,
    value: { developerToken: "서비스 경계 전용 비밀" },
  };
  const service = new MusicService(
    { save: async () => {} },
    {
      boot: resolveMusicBootConfig({
        environment: {},
        saved: { ...selected, modeId },
        legacyDefault: null,
        registry,
      }),
      registry,
      playbackDisabled,
      runtime: {
        getState: () => readyState,
        getDeveloperToken: () => {
          reads++;
          return result;
        },
      },
    },
  );
  return {
    service,
    get reads() {
      return reads;
    },
    expire() {
      result = { ok: false, error: { code: "configuration" } };
    },
  };
}

test("개발자 토큰 경계: 선택 모드에서만 getter를 호출하고 공개 상태에는 포함하지 않아요", async () => {
  const { service } = fixture();

  expect(service.getDeveloperToken()).toEqual({
    ok: true,
    value: { developerToken: "서비스 경계 전용 비밀" },
  });
  expect(JSON.stringify(await service.getSnapshot())).not.toContain(
    "서비스 경계 전용 비밀",
  );
});

test("개발자 토큰 경계: 비선택과 비활성 모드는 토큰을 읽기 전에 거절해요", () => {
  for (const instance of [
    fixture("applescript"),
    fixture("musickit", true),
    fixture("unknown"),
  ]) {
    expect(instance.service.getDeveloperToken()).toEqual({
      ok: false,
      error: { code: "unsupported" },
    });
    expect(instance.reads).toBe(0);
  }
});

test("개발자 토큰 경계: nextBoot 변경은 현재 모드나 토큰 접근을 바꾸지 않아요", async () => {
  const instance = fixture();
  await instance.service.saveConfig({ ...selected, modeId: "applescript" });

  expect(instance.service.getDeveloperToken().ok).toBe(true);
  expect((await instance.service.getSnapshot()).active).toEqual(selected);
  expect((await instance.service.getSnapshot()).restartRequired).toBe(true);
});

test("개발자 토큰 경계: 만료된 결과는 캐시하지 않고 현재 구성은 유지해요", async () => {
  const instance = fixture();
  expect(instance.service.getDeveloperToken().ok).toBe(true);
  instance.expire();

  expect(instance.service.getDeveloperToken()).toEqual({
    ok: false,
    error: { code: "configuration" },
  });
  expect((await instance.service.getSnapshot()).active).toEqual(selected);
});
