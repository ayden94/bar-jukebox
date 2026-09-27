import { useRef, useState } from "react";
import { art, fmt } from "../shared";
import type { NowPlayingView } from "../types";

export function NowPlayingCard({
  np,
  onPrevious,
  onTogglePlayback,
  onSkip,
}: {
  np: NowPlayingView | null;
  onPrevious: () => Promise<void>;
  onTogglePlayback: () => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const npSong = np?.song ?? null;
  const paused = np?.status === "paused";
  const playbackLabel = paused ? "재생" : "일시정지";
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
    <section className="panel now-panel" aria-labelledby="now-heading">
      <div className="panel-head">
        <h2 id="now-heading">지금 재생 중</h2>
        <span
          className={`playback-status${np && !paused ? " playing" : ""}`}
          role="status"
        >
          {pending
            ? "변경 중"
            : np
              ? paused
                ? "일시정지"
                : "재생 중"
              : "대기 중"}
        </span>
      </div>
      <div className="now">
        {npSong ? (
          <>
            <img src={art(npSong.artworkUrl)} alt="" />
            <div>
              <div className="title">{npSong.trackName}</div>
              <div className="artist">
                {`${npSong.artistName} · ${npSong.requestedBy}`}
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            아직 재생 중인 곡이 없어요.
            <br />
            대기열에 곡이 들어오면 음악이 시작돼요.
          </div>
        )}
      </div>
      {np ? (
        <>
          <div
            className="progress"
            role="progressbar"
            aria-label="재생 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
          >
            <div className="bar" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="playback-times">
            <span>{fmt(np.positionSec)}</span>
            <span>{fmt(np.durationSec ?? npSong?.durationSec)}</span>
          </div>
        </>
      ) : null}
      <fieldset
        className="player-controls"
        aria-label="재생 제어"
        aria-busy={pending}
      >
        <button
          className="btn ghost icon player-control"
          disabled={!np || pending}
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
          className="btn icon player-control player-toggle"
          disabled={!np || pending}
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
            {paused || !np ? (
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
          className="btn ghost icon player-control"
          disabled={!np || pending}
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
    </section>
  );
}
