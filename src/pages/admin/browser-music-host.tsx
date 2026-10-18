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
import type { BrowserMusicOptions } from "./music-registry";
import { loadBrowserMusicFactory } from "./music-registry";
import { admin } from "./styles";
import { useMusicSettings } from "./use-music-settings";

type BrowserHostValue = {
  readonly music: ReturnType<typeof useMusicSettings>;
  readonly state: BrowserHostState;
  readonly playback: PlaybackSnapshot | null;
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
        if (active) setPlayback(snapshot);
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            phase: "unknown",
            error:
              error instanceof Error
                ? error.message
                : "재생 권한을 확인하지 못했어요.",
          });
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
        await refreshMusic();
      } catch (error) {
        if (!signal.aborted) {
          setState({
            phase: "unknown",
            error:
              error instanceof Error
                ? error.message
                : "서버 상태를 확인하지 못했어요.",
          });
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

  const value = useMemo<BrowserHostValue>(
    () => ({
      music,
      state,
      playback,
      pending,
      refresh: () => action(async () => {}),
      connect: () =>
        action(async () => {
          const selected = music.snapshot?.active;
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
    [music, state, playback, pending, action, api],
  );

  return (
    <BrowserHostContext.Provider value={value}>
      {children}
    </BrowserHostContext.Provider>
  );
}

const phaseLabels = {
  disconnected: "이 브라우저는 아직 연결하지 않았어요.",
  loading: "선택한 재생기를 준비하고 있어요.",
  authorizing: "음악 계정의 재생 권한을 확인하고 있어요.",
  connecting: "이 브라우저의 재생 기기를 연결하고 있어요.",
  claiming: "서버에서 재생 권한을 확인하고 있어요.",
  connected:
    "이 브라우저가 재생을 담당해요. 실제 소리는 스피커에서 확인해주세요.",
  disconnecting: "실제 정지와 재생 권한 해제를 확인하고 있어요.",
  unknown: "재생 또는 연결 해제 결과를 확인하지 못했어요.",
  unavailable: "브라우저 재생을 아직 시작할 수 없어요.",
} as const;

export function BrowserMusicControls() {
  const host = useBrowserMusicHost();
  const [confirmed, setConfirmed] = useState<PlaybackSnapshot | null>(null);
  const owned = host.playback?.owner;
  const recovery =
    owned && !owned.released && host.state.phase !== "connected"
      ? host.playback
      : null;
  const checked = recovery !== null && confirmed === recovery;
  const pending = host.pending;
  return (
    <section className={admin.panel} aria-labelledby="browser-music-heading">
      <div className={admin.panelHead}>
        <h2 id="browser-music-heading">이 브라우저에서 재생</h2>
      </div>
      <p
        className={admin.note}
        data-browser-phase={host.state.phase}
        role="status"
      >
        {phaseLabels[host.state.phase]}
      </p>
      <p className={`${admin.note} text-[var(--admin-red)]`} role="alert">
        {host.state.error}
      </p>
      <p className={admin.note}>
        계정 확인 → 재생기 연결 → 스피커 소리 확인 순서로 준비해요. 연결 후에는
        관리자 메뉴를 이동해도 유지돼요. 새로고침이나 탭 종료 전에는 연결을
        해제해주세요.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          id="browser-music-connect"
          className={admin.button}
          disabled={
            pending ||
            host.state.phase === "connected" ||
            host.music.snapshot?.readiness === "disabled" ||
            host.music.snapshot?.readiness === "conflict"
          }
          onClick={() => void host.connect()}
          type="button"
        >
          이 브라우저 연결
        </button>
        <button
          id="browser-music-disconnect"
          className={`${admin.button} ${admin.ghost}`}
          disabled={pending || host.state.phase !== "connected"}
          onClick={() => void host.disconnect()}
          type="button"
        >
          정지하고 연결 해제
        </button>
        <button
          id="browser-music-refresh"
          className={`${admin.button} ${admin.ghost}`}
          disabled={pending}
          onClick={() => void host.refresh()}
          type="button"
        >
          재생 권한 확인
        </button>
      </div>
      {recovery && (
        <fieldset className="mt-5 min-w-0 border-0 p-0" disabled={pending}>
          <legend className="font-bold">이전 재생 연결 확인</legend>
          <p className={admin.note}>
            다른 관리자 문서가 재생 중일 수 있어요. 해당 기기에서 실제 오디오를
            멈춘 경우에만 확인해주세요. 확인 뒤에는 자동 재생하지 않고 새 연결을
            기다려요.
          </p>
          <label className="my-3 flex min-h-11 items-center gap-3">
            <input
              id="browser-music-stopped"
              className="!size-5 !min-h-0 shrink-0"
              type="checkbox"
              checked={checked}
              onChange={(event) =>
                setConfirmed(event.currentTarget.checked ? recovery : null)
              }
            />
            실제 오디오가 멈춘 것을 확인했어요
          </label>
          <button
            id="browser-music-recover"
            className={`${admin.button} ${admin.ghost}`}
            disabled={!checked || pending}
            onClick={() => {
              if (checked) void host.confirmStopped(recovery);
            }}
            type="button"
          >
            정지 확인 후 재생 권한 해제
          </button>
        </fieldset>
      )}
    </section>
  );
}
