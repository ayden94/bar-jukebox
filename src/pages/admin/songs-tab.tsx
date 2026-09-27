import type { Snapshot } from "../types";
import { AddSong } from "./add-song";
import { NowPlayingCard } from "./now-playing-card";
import { SettingsPanel } from "./settings-panel";
import { HistoryList, QueueList } from "./song-list";
import { admin } from "./styles";

type SongsTabProps = {
  snap: Snapshot | null;
  act: (path: string, body?: unknown, method?: string) => Promise<void>;
};

export function SongsTab({ snap, act }: SongsTabProps) {
  const np = snap?.nowPlaying ?? null;
  const queue = snap?.queue ?? [];
  const history = snap?.history ?? [];

  return (
    <>
      <div className={admin.pageHead}>
        <div>
          <h1>노래 관리</h1>
          <p>지금 흐르는 음악과 손님들의 신청곡을 한눈에 확인해요.</p>
        </div>
        <span className="whitespace-nowrap text-[var(--admin-muted)] max-[640.001px]:text-[0.8rem] [&_strong]:ml-1.5 [&_strong]:text-[1.1rem] [&_strong]:text-[var(--admin-ink)]">
          대기 중 <strong>{queue.length}곡</strong>
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-[var(--admin-gap)] max-[960.001px]:grid-cols-[minmax(0,1fr)]">
        <div className={admin.stack}>
          <NowPlayingCard
            np={np}
            onPrevious={() => act("/api/admin/previous")}
            onTogglePlayback={() =>
              act(
                np?.status === "paused"
                  ? "/api/admin/resume"
                  : "/api/admin/pause",
              )
            }
            onSkip={() => act("/api/admin/skip")}
          />
          <section className={admin.panel} aria-labelledby="queue-heading">
            <div className={admin.panelHead}>
              <h2 id="queue-heading">재생 대기열</h2>
              <span className={admin.count}>{queue.length}곡</span>
            </div>
            <p className={`${admin.note} !mt-[-10px] !mb-3`}>
              끌어 놓거나 화살표를 눌러 순서를 바꿔요.
            </p>
            <QueueList
              queue={queue}
              onReorder={(ids) => act("/api/admin/reorder", { ids })}
              onRemove={(id) => act("/api/admin/remove", { id })}
            />
            {queue.length ? null : (
              <div className={admin.empty}>
                대기 중인 곡이 없어요.
                <br />
                손님의 신청을 기다리거나 직접 곡을 추가해보세요.
              </div>
            )}
          </section>
          <details
            className={`${admin.panel} [&[open]_.history-summary]:mb-4.5`}
          >
            <summary className="history-summary flex cursor-pointer list-none items-center gap-2.5 text-base font-bold">
              최근 재생 <span className={admin.count}>{history.length}곡</span>
            </summary>
            <HistoryList history={history} />
            {history.length ? null : (
              <div className={admin.empty}>기록이 없어요</div>
            )}
          </details>
        </div>
        <aside
          className={`${admin.stack} max-[960.001px]:grid-cols-2 max-[960.001px]:items-start max-[640.001px]:grid-cols-[minmax(0,1fr)]`}
          aria-label="곡 추가와 운영 설정"
        >
          <AddSong
            onAdd={(hit) => act("/api/admin/add", { trackId: hit.trackId })}
          />
          <SettingsPanel
            requestsPaused={snap?.requestsPaused ?? false}
            notice={snap?.notice}
            maxPerDevice={snap?.maxPerDevice ?? 1}
            maxPerTable={snap?.maxPerTable ?? 5}
            onSave={(patch) => act("/api/admin/settings", patch)}
          />
        </aside>
      </div>
    </>
  );
}
