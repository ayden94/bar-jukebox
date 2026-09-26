import { useState } from "react";
import { art, fmt } from "../shared";
import type { NowPlayingView, SongView } from "../types";
import { PlaybackSheet } from "./playback-sheet";

type NowPlayingAreaProps = {
  np: NowPlayingView | null;
  queue: SongView[];
  onCancel: (id: string) => void;
};

export function NowPlayingArea({ np, queue, onCancel }: NowPlayingAreaProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const npSong = np?.song ?? null;
  const dur = np ? (np.durationSec ?? npSong?.durationSec ?? null) : null;
  const progress = np && dur ? Math.min(100, (np.positionSec / dur) * 100) : 0;

  return (
    <>
      {np && npSong ? (
        <button
          type="button"
          className="mini"
          onClick={() => setSheetOpen(true)}
          aria-label="재생 화면 열기"
        >
          <img src={art(npSong.artworkUrl)} alt="" />
          <div className="mi">
            <div className="mt">{npSong.trackName}</div>
            <div className="ma">
              {`${npSong.artistName} · ${npSong.requestedBy}`}
            </div>
          </div>
          <div className="eq">
            <i />
            <i />
            <i />
          </div>
        </button>
      ) : null}
      <PlaybackSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        {np && npSong ? (
          <div>
            <div className="nphead">
              <img className="bigart" src={art(npSong.artworkUrl)} alt="" />
              <div className="nplabel">지금 재생 중</div>
              <div className="nptitle">{npSong.trackName}</div>
              <div className="npartist">{npSong.artistName}</div>
              <div className="npby">{`${npSong.requestedBy}님이 신청`}</div>
            </div>
            <div className="progress">
              <div className="bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="times">
              <span>{fmt(np.positionSec)}</span>
              <span>{fmt(np.durationSec ?? npSong.durationSec)}</span>
            </div>
          </div>
        ) : (
          <div className="npempty">재생중인 곡이 없어요</div>
        )}
        <button
          type="button"
          className={`qtoggle${queueOpen ? " exp" : ""}`}
          onClick={() => setQueueOpen(!queueOpen)}
          aria-expanded={queueOpen}
        >
          <span className="left">
            {"재생 예정 "}
            <span className="count">
              {queue.length ? `· ${queue.length}곡` : ""}
            </span>
          </span>
          <span className="chev">⌃</span>
        </button>
        {queueOpen ? (
          queue.length ? (
            <ul className="qlist show">
              {queue.map((s, i) => {
                const my = s.isMine;
                return (
                  <li key={s.id} className={my ? "mine" : ""}>
                    <span className="idx">{String(i + 1)}</span>
                    <img src={art(s.artworkUrl)} alt="" />
                    <div className="info">
                      <div className="t">{s.trackName}</div>
                      <div className="a">
                        {`${s.artistName} · ${s.requestedBy}`}
                      </div>
                    </div>
                    {my ? <span className="minebadge">내 신청</span> : null}
                    {my ? (
                      <button
                        type="button"
                        className="cancelx"
                        onClick={() => onCancel(s.id)}
                        aria-label={`${s.trackName} 신청 취소`}
                      >
                        취소
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="qempty show">
              대기열이 비었어요 — 첫 곡을 신청해보세요
            </div>
          )
        ) : null}
      </PlaybackSheet>
    </>
  );
}
