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
    <div className="wrap">
      <div>
        <h2>지금 재생중</h2>
        <NowPlayingCard np={np} onSkip={() => act("/api/admin/skip")} />
        <h2>대기열</h2>
        <div className="panel">
          <QueueList
            queue={queue}
            onReorder={(ids) => act("/api/admin/reorder", { ids })}
            onRemove={(id) => act("/api/admin/remove", { id })}
          />
          {queue.length ? null : <div className="empty">대기열이 비었어요</div>}
        </div>
        <h2>최근 재생</h2>
        <div className="panel">
          <HistoryList history={history} />
          {history.length ? null : <div className="empty">기록이 없어요</div>}
        </div>
      </div>
      <div>
        <h2>곡 추가 (제한 없음)</h2>
        <AddSong
          onAdd={(hit) => act("/api/admin/add", { trackId: hit.trackId })}
        />
        <h2>운영 설정</h2>
        <SettingsPanel
          requestsPaused={snap?.requestsPaused ?? false}
          notice={snap?.notice}
          maxPerDevice={snap?.maxPerDevice ?? 1}
          maxPerTable={snap?.maxPerTable ?? 5}
          onSave={(patch) => act("/api/admin/settings", patch)}
        />
      </div>
    </div>
  );
}
