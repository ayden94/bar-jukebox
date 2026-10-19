import { useState } from "react";
import type { PlaybackSnapshot } from "../../domains/playback/protocol";
import { admin } from "./styles";

type BrowserRecoveryControlsProps = {
  readonly snapshot: PlaybackSnapshot;
  readonly pending: boolean;
  readonly onConfirm: (snapshot: PlaybackSnapshot) => void;
};

export function BrowserRecoveryControls({
  snapshot,
  pending,
  onConfirm,
}: BrowserRecoveryControlsProps) {
  const [confirmed, setConfirmed] = useState<PlaybackSnapshot | null>(null);
  const checked = confirmed === snapshot;
  return (
    <fieldset className="mt-5 min-w-0 border-0 p-0" disabled={pending}>
      <legend className="font-bold">다음 단계: 이전 기기의 소리 멈추기</legend>
      <p className={admin.note}>
        다른 관리자 문서가 재생 중일 수 있어요. 해당 기기에서 실제 오디오를 멈춘
        경우에만 확인해주세요. 확인 뒤에는 자동 재생하지 않고 새 연결을
        기다려요.
      </p>
      <label className="my-3 flex min-h-11 items-center gap-3">
        <input
          id="browser-music-stopped"
          className="!size-5 !min-h-0 shrink-0"
          type="checkbox"
          checked={checked}
          onChange={(event) =>
            setConfirmed(event.currentTarget.checked ? snapshot : null)
          }
        />
        실제 오디오가 멈춘 것을 확인했어요
      </label>
      <button
        id="browser-music-recover"
        className={`${admin.button} ${admin.ghost}`}
        disabled={!checked || pending}
        onClick={() => {
          if (checked) onConfirm(snapshot);
        }}
        type="button"
      >
        정지 확인 후 재생 권한 해제
      </button>
    </fieldset>
  );
}
