import { expect, test } from "bun:test";
import { createDatabase, initDatabase } from "../../infra/db";
import type { ArtworkPort } from "../../music/contracts";
import { musicDescriptors } from "../../music/registry";
import { createContrastingProvider } from "../../music/testing";
import { createJukeboxRuntime } from "../providers";
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
      expect(snapshot.readiness).toBe("unavailable");
      expect(snapshot.owner).toBeNull();
      expect(snapshot.auth).toBeNull();
      expect((await runtime.playbackService.snapshot()).owner).toBeNull();
    } finally {
      await runtime.dispose();
    }
  },
);

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
