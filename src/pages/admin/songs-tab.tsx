import type { Snapshot } from "../types";
import { AddSong } from "./add-song";
import { NowPlayingCard } from "./now-playing-card";
import { SettingsPanel } from "./settings-panel";
import { HistoryList, QueueList } from "./song-list";

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
      <div className="admin-pagehead">
        <div>
          <h1>노래 관리</h1>
          <p>지금 흐르는 음악과 손님들의 신청곡을 한눈에 확인해요.</p>
        </div>
        <span className="page-count">
          대기 중 <strong>{queue.length}곡</strong>
        </span>
      </div>
      <div className="wrap">
        <div className="admin-stack">
          <NowPlayingCard np={np} onSkip={() => act("/api/admin/skip")} />
          <section className="panel" aria-labelledby="queue-heading">
            <div className="panel-head">
              <h2 id="queue-heading">재생 대기열</h2>
              <span className="count">{queue.length}곡</span>
            </div>
            <p className="note queue-help">
              끌어 놓거나 화살표를 눌러 순서를 바꿔요.
            </p>
            <QueueList
              queue={queue}
              onReorder={(ids) => act("/api/admin/reorder", { ids })}
              onRemove={(id) => act("/api/admin/remove", { id })}
            />
            {queue.length ? null : (
              <div className="empty">
                대기 중인 곡이 없어요.
                <br />
                손님의 신청을 기다리거나 직접 곡을 추가해보세요.
              </div>
            )}
          </section>
          <details className="panel history-panel">
            <summary>
              최근 재생 <span className="count">{history.length}곡</span>
            </summary>
            <HistoryList history={history} />
            {history.length ? null : <div className="empty">기록이 없어요</div>}
          </details>
        </div>
        <aside
          className="admin-stack admin-sidebar"
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
