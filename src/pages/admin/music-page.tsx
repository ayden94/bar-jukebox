import { useRef, useState } from "react";
import { BrowserMusicControls } from "./browser-music-controls";
import { useBrowserMusicHost } from "./browser-music-host";
import { BrowserRecoveryControls } from "./browser-recovery-controls";
import { MusicConnectionPanel } from "./music-panel";
import { configLabel, MusicSettingsPanel } from "./music-settings-panel";
import type { MusicConfigView } from "./music-types";
import { admin } from "./styles";
import { UnsavedChanges } from "./unsaved-changes";

function RetainedBrowserRecovery() {
  const host = useBrowserMusicHost();
  const snapshot = host.playback;
  if (
    !host.music.fresh ||
    host.playbackError ||
    snapshot?.owner?.connection.location !== "browser" ||
    snapshot.owner.released ||
    snapshot.ownerConnected
  )
    return null;
  return (
    <section className={admin.panel} aria-label="이전 브라우저 재생 권한 복구">
      <BrowserRecoveryControls
        snapshot={snapshot}
        pending={host.pending || host.music.pending}
        onConfirm={(current) => void host.confirmStopped(current)}
      />
    </section>
  );
}

export default function AdminMusicPage() {
  const host = useBrowserMusicHost();
  const installation = useRef<HTMLDetailsElement>(null);
  const music = host.music;
  const active = music.snapshot?.active;
  const registration = music.snapshot?.providers.find(
    (provider) => provider.descriptor.providerId === active?.providerId,
  );
  const browserMode =
    registration?.modes.some(
      (mode) => mode.modeId === active?.modeId && mode.available,
    ) &&
    registration.descriptor.modes.find((mode) => mode.modeId === active?.modeId)
      ?.location === "browser";
  const [draft, setDraft] = useState<MusicConfigView | null>(null);
  const saved = music.snapshot?.nextBoot.config;
  const selected = draft ?? saved ?? { providerId: "", modeId: "" };
  const dirty =
    saved !== undefined &&
    (selected.providerId !== saved.providerId ||
      selected.modeId !== saved.modeId);

  return (
    <>
      <div className={admin.pageHead}>
        <div>
          <h1>음악 연결</h1>
          <p>음악 서비스 설정과 실제 재생 준비 상태를 확인해요.</p>
        </div>
        <button
          className={`${admin.button} ${admin.ghost}`}
          disabled={music.pending}
          onClick={() => void host.refresh()}
          type="button"
        >
          상태 새로고침
        </button>
      </div>
      <p className={admin.note} role="status">
        {music.pending ? "음악 설정을 확인하고 있어요." : music.message}
      </p>
      <p className={`${admin.note} text-[var(--admin-red)]`} role="alert">
        {music.error}
      </p>
      <UnsavedChanges dirty={dirty} pending={music.mutating} />
      {music.snapshot ? (
        <div className="mt-5 grid gap-[var(--admin-gap)] break-keep">
          <p className="m-0 font-semibold" data-active-mode={active?.modeId}>
            현재 매장 재생: {configLabel(music.snapshot.active, music.snapshot)}
          </p>
          {browserMode && (
            <BrowserMusicControls
              onInstallation={() => {
                if (!installation.current) return;
                installation.current.open = true;
                installation.current.querySelector("summary")?.focus();
              }}
            />
          )}
          {!browserMode &&
            (music.fresh ? (
              <>
                <MusicConnectionPanel
                  snapshot={music.snapshot}
                  targets={music.targets}
                  pending={music.pending}
                  onAction={music.act}
                  onLoadTargets={music.loadTargets}
                />
                <RetainedBrowserRecovery />
              </>
            ) : (
              <p className={admin.note}>
                현재 연결 상태를 다시 확인해주세요. 이전 상태는 준비 완료로 볼
                수 없어요.
              </p>
            ))}
          <details
            ref={installation}
            className={admin.panel}
            id="music-installation"
          >
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">
              설치 담당자용 · 다음 시작 설정
              {music.snapshot.restartRequired ? " · 재시작 필요" : ""}
            </summary>
            <p className={admin.note}>
              현재 재생 방식은 실행 중에 바뀌지 않아요. 서버 설치와 다음 시작
              설정만 여기서 관리해요.
            </p>
            {music.snapshot.reason && (
              <p className={admin.note}>{music.snapshot.reason}</p>
            )}
            <MusicSettingsPanel
              snapshot={music.snapshot}
              selected={selected}
              pending={music.pending}
              dirty={dirty}
              onChange={setDraft}
              onSave={async () => {
                if (await music.act("/config", selected)) setDraft(null);
              }}
            />
          </details>
        </div>
      ) : (
        <div className={admin.empty}>
          {music.error
            ? "연결 상태를 확인하지 못했어요. 상태 새로고침으로 다시 시도해주세요."
            : "음악 설정을 불러오고 있어요."}
        </div>
      )}
    </>
  );
}
