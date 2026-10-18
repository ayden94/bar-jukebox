import { useState } from "react";
import {
  BrowserMusicControls,
  useBrowserMusicHost,
} from "./browser-music-host";
import { MusicConnectionPanel, MusicSettingsPanel } from "./music-panel";
import type { MusicConfigView } from "./music-types";
import { admin } from "./styles";
import { UnsavedChanges } from "./unsaved-changes";

export default function AdminMusicPage() {
  const host = useBrowserMusicHost();
  const music = host.music;
  const active = music.snapshot?.active;
  const browserMode =
    music.snapshot?.providers
      .find((provider) => provider.descriptor.providerId === active?.providerId)
      ?.descriptor.modes.find((mode) => mode.modeId === active?.modeId)
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
        <div className="mt-5 grid grid-cols-2 items-start gap-[var(--admin-gap)] max-[960.001px]:grid-cols-1">
          {browserMode && <BrowserMusicControls />}
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
          {!browserMode && (
            <MusicConnectionPanel
              snapshot={music.snapshot}
              targets={music.targets}
              pending={music.pending}
              onAction={music.act}
              onLoadTargets={music.loadTargets}
            />
          )}
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
