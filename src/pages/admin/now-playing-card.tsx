import { art, fmt } from "../shared";
import type { NowPlayingView } from "../types";

export function NowPlayingCard({
  np,
  onSkip,
}: {
  np: NowPlayingView | null;
  onSkip: () => void;
}) {
  const npSong = np?.song ?? null;
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
        <span className={`playback-status${np ? " playing" : ""}`}>
          {np ? "재생 중" : "대기 중"}
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
      <div className="skiprow">
        <button
          className="btn ghost"
          disabled={!np}
          onClick={onSkip}
          type="button"
        >
          다음 곡으로 넘기기
        </button>
      </div>
    </section>
  );
}
