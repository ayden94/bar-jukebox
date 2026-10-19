import { useEffect, useRef, useState } from "react";
import { useBrowserMusicHost } from "./browser-music-host";
import { BrowserRecoveryControls } from "./browser-recovery-controls";
import { browserPreparation } from "./music-preparation";
import {
  MusicPreparationAction,
  MusicPreparationSteps,
  MusicPreparationSummary,
} from "./music-preparation-guide";
import { admin } from "./styles";

type BrowserMusicControlsProps = {
  readonly onInstallation: () => void;
};

export function BrowserMusicControls({
  onInstallation,
}: BrowserMusicControlsProps) {
  const host = useBrowserMusicHost();
  const nextAction = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  const [recoveryOwner, setRecoveryOwner] = useState<number | null>(null);
  const current = browserPreparation({
    snapshot: host.music.snapshot,
    playback: host.playback,
    state: host.state,
    fresh: host.music.fresh && !host.playbackError,
  });
  const preparation =
    current === "controller" &&
    recoveryOwner === host.playback?.owner?.ownerEpoch
      ? "recovery-required"
      : current;
  const recovery = preparation === "recovery-required" ? host.playback : null;
  const pending = host.pending || host.music.pending;
  useEffect(() => {
    if (!focusNext.current || pending || preparation === "preparing") return;
    focusNext.current = false;
    nextAction.current
      ?.querySelector<HTMLElement>("a, button:not([disabled])")
      ?.focus();
  }, [pending, preparation]);
  return (
    <section
      className={admin.panel}
      aria-labelledby="browser-music-heading"
      data-preparation={preparation}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="browser-music-heading">매장 재생 준비</h2>
        <span className={admin.count}>관리자 로그인됨</span>
      </div>
      <MusicPreparationSummary
        preparation={preparation}
        phase={host.state.phase}
        reason={host.music.snapshot?.reason ?? null}
        error={host.playbackError || host.state.error}
      />
      <div
        ref={nextAction}
        className="mt-4 flex flex-wrap gap-2"
        data-next-action={preparation}
      >
        <MusicPreparationAction
          preparation={preparation}
          pending={pending}
          onInstallation={onInstallation}
          onConnect={() => {
            focusNext.current = true;
            void host.connect();
          }}
          onRefresh={() => void host.refresh()}
        />
      </div>
      {recovery && (
        <BrowserRecoveryControls
          snapshot={recovery}
          pending={pending}
          onConfirm={(snapshot) => {
            focusNext.current = true;
            void host.confirmStopped(snapshot);
          }}
        />
      )}
      <MusicPreparationSteps preparation={preparation} />
      <details className="mt-5 border-t border-[var(--admin-panel-border)] pt-3">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">
          연결 관리와 다시 확인
        </summary>
        <p className={admin.note}>
          연결된 브라우저의 관리자 메뉴 이동은 재생을 유지해요. 새로고침이나 탭
          종료 전에는 이 기기에서 정지하고 연결을 해제해주세요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            id={preparation === "unknown" ? undefined : "browser-music-refresh"}
            className={`${admin.button} ${admin.ghost}`}
            disabled={pending}
            onClick={() => void host.refresh()}
            type="button"
          >
            재생 권한 확인
          </button>
          {host.state.phase === "connected" && (
            <button
              id="browser-music-disconnect"
              className={`${admin.button} ${admin.ghost}`}
              disabled={pending}
              onClick={() => {
                focusNext.current = true;
                void host.disconnect();
              }}
              type="button"
            >
              정지하고 연결 해제
            </button>
          )}
          {current === "controller" && (
            <button
              id="browser-music-recovery-open"
              className={`${admin.button} ${admin.ghost}`}
              disabled={pending}
              onClick={() => {
                setRecoveryOwner(host.playback?.owner?.ownerEpoch ?? null);
                void host.refresh();
              }}
              type="button"
            >
              이전 기기 연결 복구
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
