import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionTarget } from "../../music/contracts";
import type { MusicSnapshot } from "./music-types";

type AdminApi = (path: string, options?: RequestInit) => Promise<Response>;

export function useMusicSettings(api: AdminApi) {
  const [snapshot, setSnapshot] = useState<MusicSnapshot | null>(null);
  const [fresh, setFresh] = useState(false);
  const [targets, setTargets] = useState<readonly ConnectionTarget[]>([]);
  const [pending, setPending] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const lifetime = useRef<AbortController | null>(null);

  // 관리자 전용 상태예요. 손님이 구독하는 공개 스냅샷에 합치지 않아요.
  const refresh = useCallback(async () => {
    if (request.current || !lifetime.current) return;
    const controller = new AbortController();
    request.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      lifetime.current.signal,
    ]);
    setPending(true);
    setFresh(false);
    setError("");
    try {
      const response = await api("/api/admin/music", { signal });
      const data: MusicSnapshot = await response.json();
      if (!signal.aborted) {
        setSnapshot(data);
        setFresh(true);
      }
    } catch (failure) {
      if (!signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : "상태를 불러오지 못했어요.",
        );
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!signal.aborted) setPending(false);
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void refresh();
    return () => {
      controller.abort();
      request.current?.abort();
      request.current = null;
      lifetime.current = null;
    };
  }, [refresh]);

  const act = useCallback(
    async (path: string, body?: unknown): Promise<boolean> => {
      if (request.current || !lifetime.current) return false;
      const controller = new AbortController();
      request.current = controller;
      const signal = AbortSignal.any([
        controller.signal,
        lifetime.current.signal,
      ]);
      setPending(true);
      setMutating(true);
      setFresh(false);
      setError("");
      setMessage("");
      try {
        const response = await api(`/api/admin/music${path}`, {
          method: "POST",
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
        const data: MusicSnapshot = await response.json();
        if (signal.aborted) return false;
        setSnapshot(data);
        setFresh(true);
        setMessage(
          path === "/config"
            ? "다음 시작 설정을 저장했어요. 적용하려면 서버를 다시 시작해주세요."
            : "연결 상태를 확인했어요.",
        );
        return true;
      } catch (failure) {
        if (!signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "처리 결과를 확인하지 못했어요. 상태를 새로고침해주세요.",
          );
        }
        return false;
      } finally {
        if (request.current === controller) request.current = null;
        if (!signal.aborted) {
          setPending(false);
          setMutating(false);
        }
      }
    },
    [api],
  );

  const loadTargets = useCallback(async () => {
    if (request.current || !lifetime.current) return;
    const controller = new AbortController();
    request.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      lifetime.current.signal,
    ]);
    setPending(true);
    setError("");
    try {
      const response = await api("/api/admin/music/targets", { signal });
      const data: { targets: readonly ConnectionTarget[] } =
        await response.json();
      if (!signal.aborted) setTargets(data.targets);
    } catch (failure) {
      if (!signal.aborted) {
        setError(
          failure instanceof Error ? failure.message : "기기를 찾지 못했어요.",
        );
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!signal.aborted) setPending(false);
    }
  }, [api]);

  return useMemo(
    () => ({
      snapshot,
      fresh,
      targets,
      pending,
      mutating,
      error,
      message,
      refresh,
      act,
      loadTargets,
    }),
    [
      snapshot,
      fresh,
      targets,
      pending,
      mutating,
      error,
      message,
      refresh,
      act,
      loadTargets,
    ],
  );
}
