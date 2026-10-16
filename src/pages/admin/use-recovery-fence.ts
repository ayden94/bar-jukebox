import { useEffect, useState } from "react";
import type { NowPlayingView } from "../types";

export type RecoveryFence = {
  readonly expectedSongId: string;
  readonly expectedAttemptId: string | null;
  readonly expectedOwnerEpoch: number;
};

type AdminApi = (path: string, options?: RequestInit) => Promise<Response>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function captureRecoveryFence(
  api: AdminApi,
  songId: string,
  signal: AbortSignal,
): Promise<RecoveryFence> {
  const response = await api("/api/admin/playback/snapshot", { signal });
  const snapshot: unknown = await response.json();
  signal.throwIfAborted();
  if (!record(snapshot)) throw new Error("재생 확인 정보를 읽지 못했어요.");
  const { attempt, owner } = snapshot;
  if (
    attempt !== null &&
    (!record(attempt) ||
      attempt.songId !== songId ||
      typeof attempt.attemptId !== "string" ||
      !attempt.attemptId ||
      (attempt.state !== "waiting" &&
        attempt.state !== "reconciliation-required"))
  ) {
    throw new Error(
      "표시한 곡과 재생 시도가 달라요. 상태를 다시 확인해주세요.",
    );
  }
  if (
    owner !== null &&
    (!record(owner) ||
      typeof owner.ownerEpoch !== "number" ||
      !Number.isSafeInteger(owner.ownerEpoch) ||
      owner.ownerEpoch < 1)
  ) {
    throw new Error(
      "재생 주체 정보를 읽지 못했어요. 상태를 다시 확인해주세요.",
    );
  }
  return {
    expectedSongId: songId,
    expectedAttemptId: attempt === null ? null : String(attempt.attemptId),
    expectedOwnerEpoch: owner === null ? 0 : Number(owner.ownerEpoch),
  };
}

export function useRecoveryFence(np: NowPlayingView | null, api: AdminApi) {
  const [revision, setRevision] = useState(0);
  const [capture, setCapture] = useState<{
    key: string;
    api: AdminApi;
    fence: RecoveryFence | null;
    error: string;
  } | null>(null);
  const songId =
    np?.status === "waiting" || np?.status === "reconciliation-required"
      ? np.song.id
      : null;
  const status = np?.status;
  const key =
    songId === null ? null : JSON.stringify([songId, status, revision]);

  useEffect(() => {
    if (key === null || songId === null) {
      setCapture(null);
      return;
    }
    const controller = new AbortController();
    void captureRecoveryFence(api, songId, controller.signal).then(
      (fence) => {
        if (!controller.signal.aborted) {
          setCapture({ key, api, fence, error: "" });
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          setCapture({
            key,
            api,
            fence: null,
            error:
              error instanceof Error
                ? error.message
                : "재생 상태를 확인하지 못했어요.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [api, key, songId]);

  const current = capture?.key === key && capture.api === api ? capture : null;
  return {
    key,
    fence: current?.fence ?? null,
    pending: key !== null && current === null,
    error: current?.error ?? "",
    refresh: () => setRevision((value) => value + 1),
  };
}

export type RecoveryState = ReturnType<typeof useRecoveryFence>;
