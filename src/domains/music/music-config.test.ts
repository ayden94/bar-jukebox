import { expect, test } from "bun:test";
import { createDatabase, initDatabase } from "../../infra/db";
import type { ArtworkPort } from "../../music/contracts";
import { musicDescriptors } from "../../music/registry";
import { createContrastingProvider } from "../../music/testing";
import { PlaybackRepository } from "../playback/playback.repository";
import { song, connection as testConnection } from "../playback/test-support";
import { createJukeboxRuntime } from "../providers";
import { DrizzleQueueRepository } from "../queue/queue.repository";
import { MusicRepository } from "./music.repository";
import {
  registerMusicDescriptors,
  resolveMusicBootConfig,
} from "./music-config";

test.each(["darwin", "linux"])(
  "등록 설정: %s에서는 Mac의 AppleScript만 선택할 수 있어요",
  (platform) => {
    const registry = registerMusicDescriptors(musicDescriptors, platform);

    expect(registry[0]?.modes.map((mode) => mode.available)).toEqual([
      platform === "darwin",
      false,
    ]);
    expect(registry[1]?.modes[0]?.available).toBe(false);
  },
);

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

test.each([
  { providerId: "apple-music", modeId: "musickit" },
  { providerId: "youtube-music", modeId: "browser-companion" },
])(
  "실제 조립: $providerId/$modeId 직접 저장은 거절하고 기본값을 보존해요",
  async (proposed) => {
    const connection = createDatabase(":memory:");
    await initDatabase(connection);
    const runtime = await createJukeboxRuntime(
      { platform: "darwin", playbackDisabled: true },
      connection,
    );
    try {
      await expect(
        runtime.musicService.saveConfig(proposed),
      ).rejects.toMatchObject({
        code: "invalid-config",
      });
      const saved = await runtime.musicService.getSnapshot();

      expect(saved.active).toEqual({
        providerId: "apple-music",
        modeId: "applescript",
      });
      expect(saved.nextBoot.config).toEqual({
        providerId: "apple-music",
        modeId: "applescript",
      });
      expect(saved.restartRequired).toBe(false);
      expect(await new MusicRepository(connection.database).load()).toBeNull();
      expect((await runtime.playbackService.snapshot()).owner).toBeNull();
    } finally {
      await runtime.dispose();
    }
  },
);

for (const modeId of ["musickit", "browser-companion"]) {
  test.each([false, true])(
    `실제 조립: 미지원 ${modeId}의 유휴 owner 정지 확인은 오래된 fence=%s를 구분해요`,
    async (stale) => {
      const selected = {
        providerId: modeId === "musickit" ? "apple-music" : "youtube-music",
        modeId,
      };
      const db = createDatabase(":memory:");
      await initDatabase(db);
      await new MusicRepository(db.database).save(selected);
      const owner = await new PlaybackRepository(db.database).claim(
        {
          executorSessionId: "retained-idle-browser",
          connection: {
            ...testConnection,
            target: { ...selected, targetId: "previous-tab" },
            location: "browser",
          },
        },
        1,
      );
      const runtime = await createJukeboxRuntime(
        { platform: "darwin", playbackDisabled: false },
        db,
      );
      try {
        const confirmed = await runtime.playbackService.confirmBrowserStopped({
          ownerEpoch: owner.ownerEpoch + (stale ? 1 : 0),
          executorSessionId: owner.executorSessionId,
          attemptId: null,
          songId: null,
        });

        expect(confirmed).toBe(!stale);
        expect((await runtime.playbackService.snapshot()).owner).toMatchObject({
          ownerEpoch: owner.ownerEpoch,
          executorSessionId: owner.executorSessionId,
          released: !stale,
        });
        expect(runtime.queueService.snapshot().nowPlaying).toBeNull();
        expect((await runtime.musicService.getSnapshot()).active).toEqual(
          selected,
        );
        expect((await runtime.musicService.getSnapshot()).readiness).toBe(
          "setup-required",
        );
      } finally {
        await runtime.dispose();
      }
    },
  );
}

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
      expect(snapshot.nextBoot.issue).not.toBeNull();
      expect(snapshot.readiness).toBe("setup-required");
      expect(snapshot.owner).toBeNull();
      expect(snapshot.auth).toBeNull();
      expect(Object.values(snapshot.actions).every((allowed) => !allowed)).toBe(
        true,
      );
      expect(runtime.musicService.getDeveloperToken()).toEqual({
        ok: false,
        error: { code: "unsupported" },
      });
      expect(runtime.queueService.hasProviderConflict()).toBe(true);
      expect((await runtime.playbackService.snapshot()).owner).toBeNull();
    } finally {
      await runtime.dispose();
    }
  },
);

test.each([
  { providerId: "apple-music", modeId: "musickit" },
  { providerId: "youtube-music", modeId: "browser-companion" },
])(
  "실제 조립: 저장된 $modeId는 명시적 다음 시작 복구 뒤에도 현재 실행을 바꾸지 않아요",
  async (selected) => {
    const connection = createDatabase(":memory:");
    await initDatabase(connection);
    await new MusicRepository(connection.database).save(selected);
    const developerToken = [
      Buffer.from(JSON.stringify({ alg: "ES256", kid: "fixture" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          iss: "fixture",
          iat: 1,
          exp: 4102444800,
        }),
      ).toString("base64url"),
      Buffer.alloc(64, 1).toString("base64url"),
    ].join(".");
    const config = {
      platform: "darwin",
      playbackDisabled: false,
      musickitDeveloperToken: developerToken,
      environment: {},
    };

    const runtime = await createJukeboxRuntime(config, connection);

    try {
      config.musickitDeveloperToken = "changed-after-boot";
      expect(runtime.musicService.getDeveloperToken()).toEqual({
        ok: false,
        error: { code: "unsupported" },
      });
      expect(
        await runtime.musicService.connectAuth(new AbortController().signal),
      ).toEqual({ ok: false, error: { code: "unsupported" } });
      const saved = await runtime.musicService.saveConfig({
        providerId: "apple-music",
        modeId: "applescript",
      });
      expect(saved.active).toEqual(selected);
      expect(saved.activeSources).toEqual({
        providerId: "saved",
        modeId: "saved",
      });
      expect(saved.locks).toEqual({ providerId: false, modeId: false });
      expect(saved.nextBoot.config.modeId).toBe("applescript");
      expect(saved.restartRequired).toBe(true);
      expect(saved.readiness).toBe("setup-required");
      expect(saved.auth).toBeNull();
      expect(saved.owner).toBeNull();
      expect(runtime.queueService.hasProviderConflict()).toBe(true);
      expect(runtime.musicService.getDeveloperToken().ok).toBe(false);
      expect(saved.nextBoot.issue).toBeNull();
      expect(await new MusicRepository(connection.database).load()).toEqual({
        providerId: "apple-music",
        modeId: "applescript",
      });
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

test.each([
  { providerId: "apple-music", modeId: "musickit" },
  { providerId: "youtube-music", modeId: "browser-companion" },
])(
  "실제 조립: 미지원 $modeId 복원은 기존 브라우저 owner와 현재 곡을 보존해요",
  async (selected) => {
    const db = createDatabase(":memory:");
    await initDatabase(db);
    await new MusicRepository(db.database).save(selected);
    const fixture = createContrastingProvider({
      ...selected,
      location: "browser",
    });
    const signal = new AbortController().signal;
    await fixture.provider.auth.connect(signal);
    const target = await fixture.runtime.connection.connect(
      { ...selected, targetId: "speaker:anywhere" },
      signal,
    );
    if (!target.ok) throw new Error("기존 브라우저 연결이 필요해요");
    const owner = await new PlaybackRepository(db.database).claim(
      {
        executorSessionId: "previous-browser",
        connection: target.value,
      },
      1,
    );
    const current = {
      ...song("restored"),
      ref: { providerId: selected.providerId, trackId: "saved-track" },
    };
    const queue = new DrizzleQueueRepository(db.database);
    await queue.insertQueueSong(current);
    await queue.takeAndStart(current, 1);
    await fixture.provider.dispose();
    const runtime = await createJukeboxRuntime(
      { platform: "darwin", playbackDisabled: false },
      db,
    );
    try {
      await runtime.musicService.saveConfig({
        providerId: "apple-music",
        modeId: "applescript",
      });
      await runtime.playbackService.start();

      expect((await runtime.playbackService.snapshot()).owner).toEqual(owner);
      expect(runtime.queueService.snapshot().nowPlaying).toMatchObject({
        song: current,
        status: "reconciliation-required",
      });
      expect(await queue.loadNowPlaying()).toEqual({
        song: current,
        startedAt: 1,
      });
      await expect(
        runtime.playbackService.claimOwner({
          executorSessionId: "bypass-browser",
          connection: target.value,
        }),
      ).rejects.toThrow();
    } finally {
      await runtime.dispose();
    }
  },
);
