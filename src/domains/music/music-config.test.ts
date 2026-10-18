import { expect, test } from "bun:test";
import { createDatabase, initDatabase } from "../../infra/db";
import type { ArtworkPort } from "../../music/contracts";
import { musicDescriptors } from "../../music/registry";
import { createContrastingProvider } from "../../music/testing";
import { createJukeboxRuntime } from "../providers";
import { MusicRepository } from "./music.repository";
import {
  registerMusicDescriptors,
  resolveMusicBootConfig,
} from "./music-config";

test("등록 설정: 미연결 브라우저 방식은 운영체제와 무관하게 선택할 수 있어요", () => {
  const registry = registerMusicDescriptors(musicDescriptors, "linux");

  expect(registry[0]?.modes.map((mode) => mode.available)).toEqual([
    false,
    true,
  ]);
  expect(registry[1]?.modes[0]?.available).toBe(true);
});

test("부팅 설정: 환경 변수와 저장 필드를 합친 잘못된 조합은 그대로 남겨요", () => {
  const boot = resolveMusicBootConfig({
    environment: { MUSIC_PROVIDER: "youtube-music" },
    saved: { providerId: "apple-music", modeId: "musickit" },
    legacyDefault: { providerId: "apple-music", modeId: "applescript" },
    registry: registerMusicDescriptors(musicDescriptors, "darwin"),
  });

  expect(boot.active).toEqual({
    providerId: "youtube-music",
    modeId: "musickit",
  });
  expect(boot.issue).not.toBeNull();
  expect(boot.sources).toEqual({
    providerId: "environment",
    modeId: "saved",
  });
});

test("실제 조립: 미구현 방식 저장은 다음 시작에만 적용되고 owner를 만들지 않아요", async () => {
  const connection = createDatabase(":memory:");
  await initDatabase(connection);
  const runtime = await createJukeboxRuntime(
    { platform: "linux", playbackDisabled: false },
    connection,
  );
  const proposed = {
    providerId: "youtube-music",
    modeId: "browser-companion",
  };
  try {
    const saved = await runtime.musicService.saveConfig(proposed);

    expect(saved.active).toBeNull();
    expect(saved.nextBoot.config).toEqual(proposed);
    expect(saved.restartRequired).toBe(true);
    expect(saved.readiness).toBe("setup-required");
    expect((await runtime.playbackService.snapshot()).owner).toBeNull();
  } finally {
    await runtime.dispose();
  }
});

test.each([
  { providerId: "apple-music", modeId: "musickit" },
  { providerId: "youtube-music", modeId: "browser-companion" },
])(
  "실제 조립: $providerId/$modeId 등록과 준비 상태를 분리해요",
  async (selected) => {
    const connection = createDatabase(":memory:");
    await initDatabase(connection);
    const runtime = await createJukeboxRuntime(
      {
        platform: "linux",
        playbackDisabled: false,
        environment: {
          MUSIC_PROVIDER: selected.providerId,
          MUSIC_PLAYBACK_MODE: selected.modeId,
        },
      },
      connection,
    );
    try {
      const snapshot = await runtime.musicService.getSnapshot();

      expect(snapshot.active).toEqual(selected);
      expect(snapshot.nextBoot.issue).toBeNull();
      const musickit = selected.modeId === "musickit";
      expect(snapshot.readiness).toBe(
        musickit ? "auth-required" : "unavailable",
      );
      expect(snapshot.owner).toBeNull();
      if (musickit) {
        expect(snapshot.auth).toMatchObject({
          status: "reauth-required",
          authorization: "none",
          action: { kind: "user-gesture" },
        });
        const action = snapshot.auth?.action;
        if (action?.kind !== "user-gesture")
          throw new Error("인증 대기 동작이 필요해요");
        expect(snapshot.reason).toBe(action.label);
        expect(runtime.musicService.getDeveloperToken()).toEqual({
          ok: false,
          error: { code: "configuration" },
        });
      } else {
        expect(snapshot.auth).toBeNull();
      }
      expect(runtime.queueService.hasProviderConflict()).toBe(false);
      expect((await runtime.playbackService.snapshot()).owner).toBeNull();
    } finally {
      await runtime.dispose();
    }
  },
);

test("실제 조립: MusicKit 토큰은 선택 factory로 전달하고 nextBoot 저장 뒤에도 부팅 값을 유지해요", async () => {
  const connection = createDatabase(":memory:");
  await initDatabase(connection);
  const selected = { providerId: "apple-music", modeId: "musickit" };
  await new MusicRepository(connection.database).save(selected);
  const developerToken = [
    Buffer.from(JSON.stringify({ alg: "ES256", kid: "fixture" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        iss: "fixture",
        iat: 1,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    Buffer.alloc(64, 1).toString("base64url"),
  ].join(".");
  const config = {
    platform: "darwin",
    playbackDisabled: false,
    musickitDeveloperToken: developerToken,
    environment: { MUSIC_PROVIDER: "apple-music" },
  };

  const runtime = await createJukeboxRuntime(config, connection);

  try {
    config.musickitDeveloperToken = "changed-after-boot";
    expect(runtime.musicService.getDeveloperToken()).toEqual({
      ok: true,
      value: { developerToken },
    });
    expect(
      await runtime.musicService.connectAuth(new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "auth-required" } });
    const saved = await runtime.musicService.saveConfig({
      ...selected,
      modeId: "applescript",
    });
    expect(saved.active).toEqual(selected);
    expect(saved.activeSources).toEqual({
      providerId: "environment",
      modeId: "saved",
    });
    expect(saved.locks).toEqual({ providerId: true, modeId: false });
    expect(saved.nextBoot.config.modeId).toBe("applescript");
    expect(saved.restartRequired).toBe(true);
    expect(saved.readiness).toBe("auth-required");
    expect(saved.auth?.authorization).toBe("none");
    expect(saved.owner).toBeNull();
    expect(runtime.queueService.hasProviderConflict()).toBe(false);
    expect(runtime.musicService.getDeveloperToken().ok).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(developerToken);
    await expect(
      runtime.musicService.saveConfig({
        providerId: "youtube-music",
        modeId: "browser-companion",
      }),
    ).rejects.toThrow();
  } finally {
    await runtime.dispose();
  }
});

test("실제 조립: 잘못된 환경 조합은 주입한 공급자도 정리하고 연결하지 않아요", async () => {
  const connection = createDatabase(":memory:");
  await initDatabase(connection);
  const fixture = createContrastingProvider();
  let disposals = 0;
  const artwork: ArtworkPort = {
    fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
  };
  const runtime = await createJukeboxRuntime(
    {
      playbackDisabled: false,
      environment: { MUSIC_PLAYBACK_MODE: "unknown" },
      music: {
        descriptor: fixture.descriptor,
        provider: {
          ...fixture.provider,
          artwork,
          async dispose() {
            disposals++;
            await fixture.provider.dispose();
          },
        },
      },
    },
    connection,
  );
  try {
    const snapshot = await runtime.musicService.getSnapshot();

    expect(snapshot.active?.modeId).toBe("unknown");
    expect(snapshot.readiness).toBe("setup-required");
    expect(snapshot.auth).toBeNull();
    expect(snapshot.owner).toBeNull();
    expect(snapshot.actions.connectAuth).toBe(false);
    expect(disposals).toBe(1);
    expect(fixture.controls.subscriberCount).toBe(0);
  } finally {
    await runtime.dispose();
  }
});
