import { expect, test } from "bun:test";
import { captureRecoveryFence } from "./use-recovery-fence";

test("복구 확인: 브라우저 owner는 새 정지 확인 endpoint의 전체 fence를 보존해요", async () => {
  const api = async () =>
    Response.json({
      owner: {
        ownerEpoch: 7,
        executorSessionId: "browser-document",
        connection: { location: "browser" },
      },
      attempt: {
        songId: "song-1",
        attemptId: "attempt-1",
        state: "reconciliation-required",
      },
    });

  const fence = await captureRecoveryFence(
    api,
    "song-1",
    new AbortController().signal,
  );

  expect(fence.browser).toEqual({
    ownerEpoch: 7,
    executorSessionId: "browser-document",
    attemptId: "attempt-1",
    songId: "song-1",
  });
});

test("복구 확인: 화면을 표시할 때 조회한 시도와 owner 세대를 고정해요", async () => {
  let current = {
    owner: { ownerEpoch: 4 },
    attempt: {
      songId: "song-1",
      attemptId: "attempt-1",
      state: "waiting",
    },
  };
  const calls: string[] = [];
  const api = async (path: string) => {
    calls.push(path);
    return Response.json(current);
  };

  const fence = await captureRecoveryFence(
    api,
    "song-1",
    new AbortController().signal,
  );
  current = {
    owner: { ownerEpoch: 5 },
    attempt: {
      songId: "song-1",
      attemptId: "attempt-2",
      state: "waiting",
    },
  };

  expect(fence).toEqual({
    expectedSongId: "song-1",
    expectedAttemptId: "attempt-1",
    expectedOwnerEpoch: 4,
  });
  expect(calls).toEqual(["/api/admin/playback/snapshot"]);
});

test("복구 확인: 비공개 시도의 곡이 화면의 곡과 다르면 확인을 허용하지 않아요", async () => {
  const api = async () =>
    Response.json({
      owner: { ownerEpoch: 4 },
      attempt: {
        songId: "other-song",
        attemptId: "attempt-1",
        state: "waiting",
      },
    });

  await expect(
    captureRecoveryFence(api, "displayed-song", new AbortController().signal),
  ).rejects.toThrow();
});

test("복구 확인: 같은 곡이어도 이미 재생 중인 시도는 확인을 허용하지 않아요", async () => {
  const api = async () =>
    Response.json({
      owner: { ownerEpoch: 4 },
      attempt: {
        songId: "song-1",
        attemptId: "attempt-2",
        state: "playing",
      },
    });

  await expect(
    captureRecoveryFence(api, "song-1", new AbortController().signal),
  ).rejects.toThrow();
});

test("복구 확인: 이전 저장 형식의 시도와 owner가 없으면 null과 0으로 고정해요", async () => {
  const api = async () => Response.json({ owner: null, attempt: null });

  const fence = await captureRecoveryFence(
    api,
    "restored-song",
    new AbortController().signal,
  );

  expect(fence).toEqual({
    expectedSongId: "restored-song",
    expectedAttemptId: null,
    expectedOwnerEpoch: 0,
  });
});

test("복구 확인: 화면이 바뀌어 취소한 조회의 늦은 응답은 사용할 수 없어요", async () => {
  const requested = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Response>();
  const controller = new AbortController();
  const api = async () => {
    requested.resolve();
    return response.promise;
  };
  const capture = captureRecoveryFence(api, "song-1", controller.signal);

  await requested.promise;
  controller.abort(new Error("view-changed"));
  response.resolve(Response.json({ owner: null, attempt: null }));

  await expect(capture).rejects.toThrow("view-changed");
});

for (const snapshot of [
  {},
  { attempt: null },
  { owner: null },
  { attempt: null, owner: { ownerEpoch: "4" } },
  { attempt: null, owner: { ownerEpoch: -1 } },
]) {
  test(`복구 확인: 잘못된 비공개 응답 ${JSON.stringify(snapshot)}은 거절해요`, async () => {
    const api = async () => Response.json(snapshot);

    await expect(
      captureRecoveryFence(api, "song-1", new AbortController().signal),
    ).rejects.toThrow();
  });
}
