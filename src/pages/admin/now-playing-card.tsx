import { useRef, useState } from "react";
import { art, fmt, playbackStatusLabel } from "../shared";
import type { NowPlayingView } from "../types";
import { admin } from "./styles";

export function NowPlayingCard({
  np,
  onPrevious,
  onTogglePlayback,
  onSkip,
  onConfirmStopped,
}: {
  np: NowPlayingView | null;
  onPrevious: () => Promise<void>;
  onTogglePlayback: () => Promise<void>;
  onSkip: () => Promise<void>;
  onConfirmStopped: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [confirmedSongId, setConfirmedSongId] = useState<string | null>(null);
  const npSong = np?.song ?? null;
  const paused = np?.status === "paused";
  const canControl = np?.status === "playing" || paused;
  const needsConfirmation =
    np?.status === "waiting" || np?.status === "reconciliation-required";
  const playbackLabel = canControl
    ? paused
      ? "재생"
      : "일시정지"
    : np
      ? playbackStatusLabel[np.status]
      : "재생";
  const control = async (action: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const progressPct =
    np && (np.durationSec ?? npSong?.durationSec)
      ? Math.min(
          100,
          (np.positionSec / (np.durationSec ?? npSong?.durationSec ?? 1)) * 100,
        )
      : 0;

  return (
    <section className={admin.panel} aria-labelledby="now-heading">
      <div className={admin.panelHead}>
        <h2 id="now-heading">현재 곡</h2>
        <span
          className={`text-xs ${
            np?.status === "playing"
              ? "text-[var(--admin-accent)]"
              : "text-[var(--admin-muted)]"
          }`}
          role="status"
        >
          {pending
            ? "변경 중"
            : np
              ? playbackStatusLabel[np.status]
              : "대기 중"}
        </span>
      </div>
      <div className="flex items-center gap-5 max-[640.001px]:gap-3.5 [&>div]:min-w-0">
        {npSong ? (
          <>
            <img
              className="size-19 shrink-0 rounded-xl bg-[var(--admin-input-bg)] object-cover max-[640.001px]:size-15"
              src={art(npSong.artwork)}
              alt=""
            />
            <div>
              <div className="text-[1.3rem] leading-[1.4] font-bold tracking-[-0.025em] [overflow-wrap:anywhere] max-[640.001px]:text-[1.15rem]">
                {npSong.title}
              </div>
              <div className="mt-1.5 text-[0.85rem] text-[var(--admin-muted)] [overflow-wrap:anywhere]">
                {`${npSong.artist} · ${npSong.requestedBy}`}
              </div>
            </div>
          </>
        ) : (
          <div className={`${admin.empty} w-full`}>
            아직 재생 중인 곡이 없어요.
            <br />
            대기열에 곡이 들어오면 음악이 시작돼요.
          </div>
        )}
      </div>
      {np ? (
        <>
          <div
            className="mt-[22px] mb-1.5 h-1 overflow-hidden rounded bg-[var(--admin-panel-border)]"
            role="progressbar"
            aria-label="재생 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
          >
            <div
              className="h-full rounded-[inherit] bg-[var(--admin-accent)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-[var(--admin-muted)] tabular-nums">
            <span>{fmt(np.positionSec)}</span>
            <span>{fmt(np.durationSec ?? npSong?.durationSec)}</span>
          </div>
        </>
      ) : null}
      <fieldset
        className="mt-4 flex min-w-0 items-center justify-center gap-5 border-0 p-0"
        aria-label="재생 제어"
        aria-busy={pending}
      >
        <button
          className={`${admin.button} ${admin.ghost} ${admin.icon} admin-button h-11 rounded-full`}
          disabled={!canControl || pending}
          onClick={() => void control(onPrevious)}
          type="button"
          aria-label="이전 곡"
          title="이전 곡 (3초 이상 재생했으면 처음으로)"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m19 20-9-8 9-8zM5 19V5" />
          </svg>
        </button>
        <button
          className={`${admin.button} ${admin.icon} admin-button !size-14 rounded-full`}
          disabled={!canControl || pending}
          onClick={() => void control(onTogglePlayback)}
          type="button"
          aria-label={np ? playbackLabel : "재생"}
          title={np ? playbackLabel : "재생"}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {np?.status !== "playing" ? (
              <path d="m6 3 14 9-14 9z" />
            ) : (
              <>
                <rect x="5" y="3" width="4" height="18" rx="1" />
                <rect x="15" y="3" width="4" height="18" rx="1" />
              </>
            )}
          </svg>
        </button>
        <button
          className={`${admin.button} ${admin.ghost} ${admin.icon} admin-button h-11 rounded-full`}
          disabled={!np || pending || needsConfirmation}
          onClick={() => void control(onSkip)}
          type="button"
          aria-label="다음 곡"
          title="다음 곡"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 4 9 8-9 8zM19 5v14" />
          </svg>
        </button>
      </fieldset>
      {np && needsConfirmation ? (
        <fieldset className="mt-4 min-w-0 border-0 p-0" disabled={pending}>
          <legend className="font-bold">재생 상태 확인</legend>
          <p className={admin.note}>
            음악 앱이나 재생 기기에서 오디오를 직접 멈춘 뒤 확인해주세요.
            확인하면 현재 신청을 마치고 다음 곡으로 넘어가요.
          </p>
          <label className="my-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              className="!size-5 !min-h-0 shrink-0"
              type="checkbox"
              checked={confirmedSongId === np.song.id}
              onChange={(event) =>
                setConfirmedSongId(
                  event.currentTarget.checked ? np.song.id : null,
                )
              }
            />
            실제 오디오가 멈춘 것을 확인했어요
          </label>
          <button
            className={`${admin.button} ${admin.ghost} min-h-11`}
            type="button"
            disabled={pending || confirmedSongId !== np.song.id}
            onClick={() => void control(onConfirmStopped)}
          >
            정지 확인 후 넘기기
          </button>
        </fieldset>
      ) : null}
    </section>
  );
}
