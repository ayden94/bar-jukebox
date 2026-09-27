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
          className="fixed bottom-[calc(8px+env(safe-area-inset-bottom))] left-1/2 z-20 flex min-h-17 w-[min(calc(100%-40px),600px)] -translate-x-1/2 cursor-pointer items-center gap-[11px] rounded-[var(--guest-radius)] border border-[var(--guest-stroke)] bg-[var(--guest-surface)] py-[9px] pr-4 pl-[9px] text-left text-[var(--guest-ink)] shadow-[var(--guest-shadow)] transition-transform duration-[var(--guest-speed)] ease-[var(--guest-ease)] active:scale-98 max-[420.001px]:w-[calc(100%-32px)]"
          onClick={() => setSheetOpen(true)}
          aria-label="재생 화면 열기"
        >
          <img
            className="size-12 shrink-0 rounded-lg bg-[var(--card-bg)] object-cover"
            src={art(npSong.artworkUrl)}
            alt=""
          />
          <div className="min-w-0 flex-1">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.93rem] leading-[1.4] font-bold">
              {npSong.trackName}
            </div>
            <div className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-[0.78rem] text-[var(--guest-muted)]">
              {`${npSong.artistName} · ${npSong.requestedBy}`}
            </div>
          </div>
          <div className="flex h-4 shrink-0 items-end gap-[2.5px] pr-1 [&_i]:w-[3px] [&_i]:rounded-sm [&_i]:bg-[var(--guest-accent)] [&_i]:animate-[eqb_0.9s_ease-in-out_infinite] motion-reduce:[&_i]:animate-none [&_i:nth-child(1)]:h-[60%] [&_i:nth-child(2)]:h-full [&_i:nth-child(2)]:[animation-delay:0.25s] [&_i:nth-child(3)]:h-[45%] [&_i:nth-child(3)]:[animation-delay:0.5s]">
            <i />
            <i />
            <i />
          </div>
        </button>
      ) : null}
      <PlaybackSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        {np && npSong ? (
          <div>
            <div className="text-center">
              <img
                className="mx-auto mt-3 mb-6 block aspect-square w-[min(68vw,290px,38dvh)] rounded-[19px] bg-[var(--card-bg)] object-cover"
                src={art(npSong.artworkUrl)}
                alt=""
              />
              <div className="text-[0.74rem] font-extrabold tracking-[0.03em] text-[var(--guest-accent)] uppercase">
                지금 재생 중
              </div>
              <div className="mx-auto mt-[9px] mb-1 max-w-[28ch] text-[clamp(1.3rem,5vw,1.8rem)] leading-tight font-extrabold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">
                {npSong.trackName}
              </div>
              <div className="text-[0.95rem] text-[var(--guest-muted)] [overflow-wrap:anywhere]">
                {npSong.artistName}
              </div>
              <div className="mt-2.5 inline-block rounded-full bg-[var(--guest-accent-wash)] px-3.5 py-2 text-xs text-[var(--guest-ink)]">
                {`${npSong.requestedBy}님이 신청`}
              </div>
            </div>
            <div className="mt-7 mb-1.5 h-[5px] overflow-hidden rounded-sm bg-[var(--guest-stroke)]">
              <div
                className="h-full rounded-sm bg-[var(--guest-accent)]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[0.78rem] text-[var(--guest-muted)] tabular-nums">
              <span>{fmt(np.positionSec)}</span>
              <span>{fmt(np.durationSec ?? npSong.durationSec)}</span>
            </div>
          </div>
        ) : (
          <div className="leading-[1.6] text-[var(--guest-muted)]">
            재생중인 곡이 없어요
          </div>
        )}
        <button
          type="button"
          className="mt-[22px] flex min-h-15 w-full cursor-pointer items-center justify-between border-0 border-t border-[var(--guest-stroke)] bg-transparent px-0.5 py-4 text-base font-bold text-[var(--guest-ink)]"
          onClick={() => setQueueOpen(!queueOpen)}
          aria-expanded={queueOpen}
        >
          <span className="flex items-center gap-2">
            {"재생 예정 "}
            <span className="text-[0.85rem] font-semibold text-[var(--guest-muted)]">
              {queue.length ? `· ${queue.length}곡` : ""}
            </span>
          </span>
          <span
            className={`inline-block text-[var(--guest-muted)] transition-transform duration-250 ${
              queueOpen ? "rotate-180" : ""
            }`}
          >
            ⌃
          </span>
        </button>
        {queueOpen ? (
          queue.length ? (
            <ul className="m-0 list-none pb-6">
              {queue.map((s, i) => {
                const my = s.isMine;
                return (
                  <li
                    key={s.id}
                    className={`flex min-w-0 items-center gap-[9px] rounded-[10px] py-2.5 ${
                      my ? "bg-[var(--guest-accent-wash)] px-2" : "px-0.5"
                    }`}
                  >
                    <span className="w-4.5 shrink-0 text-center text-[0.8rem] font-bold text-[var(--guest-muted)] tabular-nums">
                      {String(i + 1)}
                    </span>
                    <img
                      className="size-11 shrink-0 rounded-[9px] bg-[var(--card-bg)] object-cover"
                      src={art(s.artworkUrl)}
                      alt=""
                    />
                    <div className="min-w-0 flex-1">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.88rem] leading-[1.35] font-semibold text-[var(--guest-ink)] [overflow-wrap:anywhere]">
                        {s.trackName}
                      </div>
                      <div className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.74rem] leading-[1.4] text-[var(--guest-muted)]">
                        {`${s.artistName} · ${s.requestedBy}`}
                      </div>
                    </div>
                    {my ? (
                      <span className="shrink-0 whitespace-nowrap text-[0.7rem] font-extrabold text-[var(--guest-accent)]">
                        내 신청
                      </span>
                    ) : null}
                    {my ? (
                      <button
                        type="button"
                        className="size-11 shrink-0 cursor-pointer rounded-[11px] border-0 bg-[color-mix(in_srgb,var(--guest-accent)_16%,var(--guest-surface))] text-[0.76rem] font-bold text-[var(--guest-accent)] hover:brightness-115 active:scale-96"
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
            <div className="px-0.5 pt-3.5 pb-7.5 text-[0.85rem] leading-[1.6] text-[var(--guest-muted)]">
              대기열이 비었어요 — 첫 곡을 신청해보세요
            </div>
          )
        ) : null}
      </PlaybackSheet>
    </>
  );
}
