import { expect, test } from "bun:test";
import { createDatabase, initDatabase } from "../infra/db";
import type { ArtworkPort } from "../music/contracts";
import { createContrastingProvider } from "../music/testing";
import { createJukeboxRuntime } from "./providers";
import { makeSong } from "./shared/song";

const artwork: ArtworkPort = {
  fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
};

test("다른 공급자를 같은 검색·신청·저장 조립에 주입해요", async () => {
  const connection = createDatabase(":memory:");
  await initDatabase(connection);
  const fixture = createContrastingProvider();
  const runtime = await createJukeboxRuntime(
    {
      playbackDisabled: true,
      music: {
        descriptor: fixture.descriptor,
        provider: { ...fixture.provider, artwork },
      },
    },
    connection,
  );
  try {
    const page = await runtime.searchService.search("");
    const hit = page.hits[0];
    expect(hit).toBeDefined();
    if (!hit) throw new Error("검증할 곡이 필요해요");
    const verified = await runtime.searchService.lookup(hit.ref);
    const song = makeSong(verified, "테이블", "device", false, 1);
    expect(await runtime.queueService.enqueue(song)).toBeNull();
    expect(await runtime.queueRepository.loadQueue()).toEqual([song]);
    expect(song.durationSec).toBeNull();
    expect(song.ref.trackId).toBe("Mix:Aa/_?한글");
    await runtime.playbackService.start();
    expect(runtime.queueService.snapshot().nowPlaying).toBeNull();
    expect(fixture.controls.pendingSequences()).toEqual([]);
  } finally {
    await runtime.dispose();
  }
});

test("등록 정보와 다른 공급자 또는 필수 기능 누락을 거절해요", async () => {
  for (const invalid of ["identity", "capability"] as const) {
    const connection = createDatabase(":memory:");
    await initDatabase(connection);
    const fixture = createContrastingProvider(
      invalid === "capability" ? { capabilities: { canRestart: false } } : {},
    );
    try {
      await expect(
        createJukeboxRuntime(
          {
            playbackDisabled: true,
            music: {
              descriptor:
                invalid === "identity"
                  ? { ...fixture.descriptor, providerId: "wrong" }
                  : fixture.descriptor,
              provider: { ...fixture.provider, artwork },
            },
          },
          connection,
        ),
      ).rejects.toThrow();
    } finally {
      connection.client.close();
    }
  }
});
