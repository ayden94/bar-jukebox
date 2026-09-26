import { art } from "../shared";
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
    <div className="panel">
      <div className="now">
        {npSong ? (
          <>
            <img src={art(npSong.artworkUrl)} alt="" />
            <div>
              <div className="label">재생중</div>
              <div className="title">{npSong.trackName}</div>
              <div className="artist">{`${npSong.artistName} · ${npSong.requestedBy}`}</div>
            </div>
          </>
        ) : (
          <div className="empty">재생중인 곡이 없어요</div>
        )}
      </div>
      {np ? (
        <div className="progress">
          <div className="bar" style={{ width: `${progressPct}%` }} />
        </div>
      ) : null}
      <div className="skiprow">
        <button
          className="btn danger"
          disabled={!np}
          onClick={onSkip}
          type="button"
        >
          ⏭ 스킵 (다음 곡으로)
        </button>
      </div>
    </div>
  );
}
