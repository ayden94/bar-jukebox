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
      {queue.map((s) => (
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
          <span className="grip">⠿</span>
          <img src={art(s.artworkUrl)} alt="" />
          <div className="info">
            <div className="t">{s.trackName}</div>
            <div className="a">{s.artistName}</div>
          </div>
          <span className="by">{s.requestedBy}</span>
          <button className="del" type="button" onClick={() => onRemove(s.id)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

export function HistoryList({ history }: { history: SongView[] }) {
  return (
    <ul className="queue">
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
