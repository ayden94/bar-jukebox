import { useRef, useState } from "react";
import { useInfiniteScroll } from "../hooks";
import { SearchMoreButton } from "../search-more-button";
import { art, trackKey } from "../shared";
import type { TrackMetadata } from "../types";
import { useTrackSearch } from "../use-track-search";
import { admin } from "./styles";

type AddSongProps = {
  onAdd: (hit: TrackMetadata) => Promise<void>;
};

export function AddSong({ onAdd }: AddSongProps) {
  const [q, setQ] = useState("");
  const {
    results,
    searching,
    searchedTerm,
    loadingMore,
    pageError,
    hasMore,
    clear,
    search,
    loadMore,
  } = useTrackSearch((message) => window.alert(message));
  const [adding, setAdding] = useState<string | null>(null);
  const addPending = useRef(false);
  const moreRef = useInfiniteScroll(
    hasMore && !loadingMore && !pageError,
    loadMore,
  );

  return (
    <section className={admin.panel} aria-labelledby="add-heading">
      <div className={admin.panelHead}>
        <h2 id="add-heading">곡 추가</h2>
        <span className={admin.count}>바텐더</span>
      </div>
      <p className={`${admin.note} !mt-[-8px] !mb-4.5`}>
        손님 신청과 별개로 원하는 곡을 추가해요.
      </p>
      <form
        className={admin.field}
        onSubmit={(event) => {
          event.preventDefault();
          if (!searching) void search(q);
        }}
      >
        <input
          id="admin-search"
          type="search"
          aria-label="추가할 노래나 가수 검색"
          placeholder="노래나 가수 검색"
          enterKeyHint="search"
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            clear();
          }}
        />
        <button
          className={`${admin.button} admin-button`}
          type="submit"
          disabled={!q.trim() || searching}
        >
          {searching ? "검색 중" : "검색"}
        </button>
      </form>
      <p className={`${admin.note} !my-3`} role="status">
        {searching
          ? "곡을 찾고 있어요"
          : searchedTerm
            ? results.length
              ? `검색 결과 ${results.length}곡`
              : "검색 결과가 없어요. 다른 검색어를 입력해보세요."
            : "검색 후 대기열에 추가할 수 있어요."}
      </p>
      <ul className="m-0 max-h-90 list-none overflow-y-auto p-0 [overscroll-behavior:contain]">
        {results.map((h) => (
          <li
            className="flex items-center gap-2.5 border-t border-[var(--admin-panel-border)] py-3"
            key={trackKey(h.ref)}
          >
            <img
              className="size-9 shrink-0 rounded-md object-cover"
              src={art(h.artwork)}
              alt=""
            />
            <div className="min-w-0 flex-1">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                {h.title}
              </div>
              <div className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--admin-muted)]">
                {h.artist}
              </div>
            </div>
            <button
              className={`${admin.button} ${admin.ghost} admin-button`}
              type="button"
              disabled={adding !== null}
              onClick={async () => {
                if (addPending.current) return;
                addPending.current = true;
                setAdding(trackKey(h.ref));
                try {
                  await onAdd(h);
                } finally {
                  addPending.current = false;
                  setAdding(null);
                }
              }}
            >
              {adding === trackKey(h.ref) ? "추가 중" : "추가"}
            </button>
          </li>
        ))}
        {hasMore ? (
          <li
            className="flex justify-center border-b-0 py-3 text-[0.8rem] text-[var(--admin-muted)]"
            key="more"
            ref={moreRef}
          >
            <SearchMoreButton
              className={`${admin.button} ${admin.ghost} admin-button`}
              loading={loadingMore}
              failed={pageError}
              onLoad={() => void loadMore()}
            />
          </li>
        ) : null}
      </ul>
    </section>
  );
}
