import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PlaybackSnapshot } from "../../domains/playback/protocol";
import {
  type BrowserHostState,
  BrowserMusicLifecycle,
} from "./browser-music-lifecycle";
import { browserPreparation } from "./music-preparation";
import type { BrowserMusicOptions } from "./music-registry";
import { loadBrowserMusicFactory } from "./music-registry";
import { useMusicSettings } from "./use-music-settings";

type BrowserHostValue = {
  readonly music: ReturnType<typeof useMusicSettings>;
  readonly state: BrowserHostState;
  readonly playback: PlaybackSnapshot | null;
  readonly playbackError: string;
  readonly pending: boolean;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly confirmStopped: (snapshot: PlaybackSnapshot) => Promise<void>;
};

const BrowserHostContext = createContext<BrowserHostValue | null>(null);

export function useBrowserMusicHost() {
  const value = useContext(BrowserHostContext);
  if (!value) throw new Error("관리자 브라우저 호스트가 필요해요.");
  return value;
}

type BrowserMusicHostProps = Omit<BrowserMusicOptions, "registerCatalog"> & {
  readonly token: string;
  readonly children: ReactNode;
};

// AdminSession의 라우트 slot 밖에 있어 내부 이동에도 실행기를 유지해요.
export function BrowserMusicHost({
  api,
  token,
  children,
}: BrowserMusicHostProps) {
  const music = useMusicSettings(api);
  const host = useRef<BrowserMusicLifecycle | null>(null);
  const [state, setState] = useState<BrowserHostState>({
    phase: "disconnected",
    error: "",
  });
  const [playback, setPlayback] = useState<PlaybackSnapshot | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const [pendingOwner, setPendingOwner] = useState<AbortController | null>(
    null,
  );
  const pending = pendingOwner !== null;
  const busy = useRef(false);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    lifetime.current = controller;
    const lifecycle = new BrowserMusicLifecycle({
      token,
      api,
      loadFactory: loadBrowserMusicFactory,
    });
    host.current = lifecycle;
    const unsubscribe = lifecycle.subscribe(() =>
      setState(lifecycle.getSnapshot()),
    );
    void api("/api/admin/playback/snapshot", { signal: controller.signal })
      .then((response) => response.json())
      .then((snapshot: PlaybackSnapshot) => {
        if (active) {
          setPlayback(snapshot);
          setPlaybackError("");
        }
      })
      .catch((error: unknown) => {
        if (active)
          setPlaybackError(
            error instanceof Error
              ? error.message
              : "재생 권한을 확인하지 못했어요.",
          );
      });
    const pagehide = () => void lifecycle.abandon();
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) void lifecycle.resume();
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      active = false;
      controller.abort();
      lifetime.current = null;
      host.current = null;
      unsubscribe();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      // 인증 철회 시에도 기존 인증 정보로 가능한 정지·해제를 먼저 시도해요.
      void lifecycle.close();
    };
  }, [api, token]);

  const refreshMusic = music.refresh;
  const action = useCallback(
    async (run: () => Promise<void>) => {
      if (busy.current || !lifetime.current) return;
      const controller = lifetime.current;
      const signal = controller.signal;
      busy.current = true;
      setPendingOwner(controller);
      try {
        await run();
        if (signal.aborted) return;
        const response = await api("/api/admin/playback/snapshot", { signal });
        const snapshot: PlaybackSnapshot = await response.json();
        if (signal.aborted) return;
        setPlayback(snapshot);
        setPlaybackError("");
        await refreshMusic();
      } catch (error) {
        if (!signal.aborted) {
          setPlaybackError(
            error instanceof Error
              ? error.message
              : "서버 상태를 확인하지 못했어요.",
          );
        }
      } finally {
        if (lifetime.current === controller) {
          busy.current = false;
          setPendingOwner((current) =>
            current === controller ? null : current,
          );
        }
      }
    },
    [api, refreshMusic],
  );

  useEffect(() => {
    const onFocus = () => void action(async () => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [action]);

  const value = useMemo<BrowserHostValue>(
    () => ({
      music,
      state,
      playback,
      playbackError,
      pending,
      refresh: () => action(async () => {}),
      connect: () =>
        action(async () => {
          const selected = music.snapshot?.active;
          if (
            browserPreparation({
              snapshot: music.snapshot,
              playback,
              state,
              fresh: music.fresh && !playbackError,
            }) !== "connect"
          )
            return;
          const descriptor = music.snapshot?.providers.find(
            (entry) => entry.descriptor.providerId === selected?.providerId,
          )?.descriptor;
          if (selected && descriptor)
            await host.current?.connect(selected, descriptor);
        }),
      disconnect: () =>
        action(async () => {
          await host.current?.disconnect();
        }),
      confirmStopped: (snapshot) =>
        action(async () => {
          const owner = snapshot.owner;
          if (
            !owner ||
            owner.released ||
            owner.connection.location !== "browser"
          )
            throw new Error(
              "확인할 브라우저 재생 권한이 없어요. 상태를 다시 확인해주세요.",
            );
          await host.current?.disconnect();
          await api("/api/admin/playback/confirm-browser-stopped", {
            method: "POST",
            signal: lifetime.current?.signal,
            body: JSON.stringify({
              ownerEpoch: owner.ownerEpoch,
              executorSessionId: owner.executorSessionId,
              attemptId: snapshot.attempt?.attemptId ?? null,
              songId: snapshot.attempt?.songId ?? null,
            }),
          });
          setState({ phase: "disconnected", error: "" });
        }),
    }),
    [music, state, playback, playbackError, pending, action, api],
  );

  return (
    <BrowserHostContext.Provider value={value}>
      {children}
    </BrowserHostContext.Provider>
  );
}
