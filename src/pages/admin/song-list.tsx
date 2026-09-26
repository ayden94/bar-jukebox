import { useRef, useState } from "react";
import { art } from "../shared";
import type { SongView } from "../types";

type QueueListProps = {
  queue: SongView[];
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
};

export function QueueList({ queue, onReorder, onRemove }: QueueListProps) {
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <ul className="queue">
      {queue.map((s, index) => (
        <li
          key={s.id}
          draggable
          onDragStart={() => (dragIdRef.current = s.id)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(s.id);
          }}
          onDragEnd={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (!dragIdRef.current) return;
            const ids = queue.map((x) => x.id);
            const from = ids.indexOf(dragIdRef.current);
            const to = ids.indexOf(s.id);
            if (from >= 0 && to >= 0) {
              ids.splice(to, 0, ...ids.splice(from, 1));
              onReorder(ids);
            }
            dragIdRef.current = null;
            setDragOverId(null);
          }}
          className={dragOverId === s.id ? "dragover" : ""}
        >
          <span className="grip" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <img src={art(s.artworkUrl)} alt="" />
          <div className="info">
            <div className="t">{s.trackName}</div>
            <div className="a">
              {s.artistName} · {s.requestedBy}
            </div>
          </div>
          <div className="queue-actions">
            <button
              className="btn icon ghost"
              type="button"
              disabled={index === 0}
              aria-label={`${s.trackName} 위로 이동`}
              onClick={() => {
                const ids = queue.map((song) => song.id);
                ids.splice(index - 1, 0, ...ids.splice(index, 1));
                onReorder(ids);
              }}
            >
              ↑
            </button>
            <button
              className="btn icon ghost"
              type="button"
              disabled={index === queue.length - 1}
              aria-label={`${s.trackName} 아래로 이동`}
              onClick={() => {
                const ids = queue.map((song) => song.id);
                ids.splice(index + 1, 0, ...ids.splice(index, 1));
                onReorder(ids);
              }}
            >
              ↓
            </button>
            <button
              className="btn danger"
              type="button"
              aria-label={`${s.trackName} 대기열에서 삭제`}
              onClick={() => onRemove(s.id)}
            >
              삭제
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function HistoryList({ history }: { history: SongView[] }) {
  return (
    <ul className="queue history">
      {history.map((s) => (
        <li key={s.id}>
          <img src={art(s.artworkUrl)} alt="" />
          <div className="info">
            <div className="t">{s.trackName}</div>
            <div className="a">{s.artistName}</div>
          </div>
          <span className="by">{s.requestedBy}</span>
        </li>
      ))}
    </ul>
  );
}
