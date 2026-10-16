import { expect, test } from "bun:test";
import { createDatabase, initDatabase } from "../infra/db";
import type { ArtworkPort } from "../music/contracts";
import { createContrastingProvider } from "../music/testing";
import { PlaybackRepository } from "./playback/playback.repository";
import { createJukeboxRuntime } from "./providers";
import { makeSong } from "./shared/song";

const artwork: ArtworkPort = {
  fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
};

for (const failConnection of [true, false]) {
  test(`복원된 서버 owner의 준비 상태는 현재 연결 ${failConnection ? "실패" : "성공"}을 반영해요`, async () => {
    const db = createDatabase(":memory:");
    await initDatabase(db);
    const signal = new AbortController().signal;
    const previous = createContrastingProvider();
    await previous.provider.auth.connect(signal);
    const targets = await previous.runtime.connection.listTargets(signal);
    if (!targets.ok || !targets.value[0]) throw new Error("target이 필요해요");
    const connected = await previous.runtime.connection.connect(
      targets.value[0].ref,
      signal,
    );
    if (!connected.ok) throw new Error("연결이 필요해요");
    const oldOwner = await new PlaybackRepository(db.database).claim(
      {
        executorSessionId: "previous-server-session",
        connection: connected.value,
      },
      1,
    );
    await previous.provider.dispose();
    const fresh = createContrastingProvider();
    if (failConnection) {
      fresh.runtime.connection.connect = async () => ({
        ok: false,
        error: { code: "permission-denied" },
      });
    }
    const runtime = await createJukeboxRuntime(
      {
        playbackDisabled: false,
        music: {
          descriptor: fresh.descriptor,
          provider: { ...fresh.provider, artwork },
        },
      },
      db,
    );
    const running = runtime.playbackService.start();
    try {
      await runtime.playbackService.heartbeat(oldOwner);
      const state = await runtime.musicService.getSnapshot();
      const protocol = await runtime.playbackService.snapshot();
      expect(protocol.ownerConnected).toBe(!failConnection);
      expect(state.readiness).toBe(failConnection ? "unavailable" : "ready");
      if (failConnection) {
        expect(state.connectedTarget).toBeNull();
        expect(protocol.owner?.ownerEpoch).toBe(oldOwner.ownerEpoch);
        expect(protocol.owner?.executorSessionId).toBe(
          oldOwner.executorSessionId,
        );
        expect(protocol.owner?.released).toBe(false);
        expect(state.owner?.executorSessionId).toBe(oldOwner.executorSessionId);
      } else {
        expect(state.connectedTarget).toEqual(connected.value);
      }
    } finally {
      await runtime.dispose();
      await running;
    }
  });
}

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
