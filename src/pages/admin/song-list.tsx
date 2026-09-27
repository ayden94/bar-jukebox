import { useRef, useState } from "react";
import { art } from "../shared";
import type { SongView } from "../types";
import { admin } from "./styles";

type QueueListProps = {
  queue: SongView[];
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
};

export function QueueList({ queue, onReorder, onRemove }: QueueListProps) {
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <ul className="m-0 list-none p-0">
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
          className={`grid grid-cols-[24px_40px_minmax(0,1fr)_auto] items-center gap-3 border-t border-[var(--admin-panel-border)] py-3.5 first:border-t-0 max-[640.001px]:grid-cols-[22px_40px_minmax(0,1fr)] max-[640.001px]:gap-2.5 ${
            dragOverId === s.id ? "rounded-lg bg-[var(--admin-input-bg)]" : ""
          }`}
        >
          <span
            className="cursor-grab select-none text-xs text-[var(--admin-muted)] tabular-nums"
            aria-hidden="true"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <img
            className="size-10 rounded-[7px] bg-[var(--admin-input-bg)] object-cover"
            src={art(s.artworkUrl)}
            alt=""
          />
          <div className="min-w-0">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
              {s.trackName}
            </div>
            <div className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--admin-muted)]">
              {s.artistName} · {s.requestedBy}
            </div>
          </div>
          <div className="flex items-center gap-1 max-[640.001px]:col-[2/-1] max-[640.001px]:justify-end">
            <button
              className={`${admin.button} ${admin.icon} ${admin.ghost} admin-button !px-2.5`}
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
              className={`${admin.button} ${admin.icon} ${admin.ghost} admin-button !px-2.5`}
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
              className={`${admin.button} ${admin.danger} admin-button !px-2.5`}
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
    <ul className="m-0 list-none p-0 [&_li]:grid [&_li]:grid-cols-[40px_minmax(0,1fr)_auto] [&_li]:items-center [&_li]:gap-3 [&_li]:border-t [&_li]:border-[var(--admin-panel-border)] [&_li]:py-3.5 [&_li:first-child]:border-t-0 max-[640.001px]:[&_li]:grid-cols-[40px_minmax(0,1fr)]">
      {history.map((s) => (
        <li key={s.id}>
          <img
            className="size-10 rounded-[7px] bg-[var(--admin-input-bg)] object-cover"
            src={art(s.artworkUrl)}
            alt=""
          />
          <div className="min-w-0">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
              {s.trackName}
            </div>
            <div className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--admin-muted)]">
              {s.artistName}
            </div>
          </div>
          <span className="max-w-25 text-xs text-[var(--admin-muted)] [overflow-wrap:anywhere] max-[640.001px]:col-start-2">
            {s.requestedBy}
          </span>
        </li>
      ))}
    </ul>
  );
}
