import { expect, test } from "bun:test";
import type { ConnectionPort } from "../../music/contracts";
import { connection, FakePlayer, fixture, song, state } from "./test-support";

test("서버 기기 재연결은 owner 정지·해제 뒤 새 세대로만 재생해요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  await f.queue.enqueue(song("b"));
  let connects = 0;
  let disconnects = 0;
  const port: ConnectionPort = {
    listTargets: async () => ({ ok: true, value: [] }),
    connect: async () => ({
      ok: true,
      value: {
        ...connection,
        connectionGeneration: `connection:${++connects}`,
      },
    }),
    disconnect: async () => {
      disconnects += 1;
      return { ok: true, value: undefined };
    },
  };
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    serverMode: connection.target,
    serverConnection: port,
  });
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  expect(
    await playback.connectTarget(
      connection.target,
      new AbortController().signal,
    ),
  ).toEqual({ ok: true, value: undefined });
  await playing;
  const oldOwner = (await playback.snapshot()).owner;
  expect(oldOwner).not.toBeNull();
  expect(
    (
      await playback.connectTarget(
        connection.target,
        new AbortController().signal,
      )
    ).ok,
  ).toBe(false);
  expect(connects).toBe(1);
  expect(
    (await playback.disconnectTarget(new AbortController().signal)).ok,
  ).toBe(true);
  expect(disconnects).toBe(1);
  expect((await playback.snapshot()).owner?.released).toBe(true);
  expect(f.queue.nowPlayingSong()).toBeNull();
  expect(f.queue.snapshot().queue.map((s) => s.id)).toEqual(["b"]);
  const next = state(
    f.queue,
    (s) => s.nowPlaying?.song.id === "b" && s.nowPlaying.status === "playing",
  );
  expect(
    (
      await playback.connectTarget(
        connection.target,
        new AbortController().signal,
      )
    ).ok,
  ).toBe(true);
  await next;
  expect((await playback.snapshot()).owner?.ownerEpoch).toBeGreaterThan(
    oldOwner!.ownerEpoch,
  );
  expect(await playback.authorize(oldOwner!)).toBe(false);
  expect(f.queue.snapshot().history.map((s) => s.id)).toEqual(["a"]);
});

test("연결 실패와 다른 공급자 선택은 큐나 owner를 바꾸지 않아요", async () => {
  await using f = await fixture();
  await f.queue.enqueue(song("a"));
  let calls = 0;
  const player = new FakePlayer();
  const { playback } = f.start(player, null, undefined, undefined, {
    serverMode: connection.target,
    serverConnection: {
      listTargets: async () => ({ ok: true, value: [] }),
      connect: async () => {
        calls += 1;
        return { ok: false, error: { code: "permission-denied" } };
      },
      disconnect: async () => ({ ok: true, value: undefined }),
    },
  });
  expect(
    (
      await playback.connectTarget(
        { ...connection.target, providerId: "other" },
        new AbortController().signal,
      )
    ).ok,
  ).toBe(false);
  expect(calls).toBe(0);
  expect(
    (
      await playback.connectTarget(
        connection.target,
        new AbortController().signal,
      )
    ).ok,
  ).toBe(false);
  expect(calls).toBe(1);
  expect((await playback.snapshot()).owner).toBeNull();
  expect(f.queue.snapshot().queue.map((s) => s.id)).toEqual(["a"]);
  expect(player.calls).toEqual([]);
});
