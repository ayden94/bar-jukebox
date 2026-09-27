import { useEffect, useRef, useState } from "react";
import { useInfiniteScroll } from "../hooks";
import { apiErrorMessage, art, SEARCH_PAGE } from "../shared";
import type { SearchHit } from "../types";
import { admin } from "./styles";

type AddSongProps = {
  onAdd: (hit: SearchHit) => Promise<void>;
};

export function AddSong({ onAdd }: AddSongProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const searchVersion = useRef(0);
  useEffect(
    () => () => {
      ++searchVersion.current;
      searchAbort.current?.abort();
    },
    [],
  );
  const moreRef = useInfiniteScroll(visibleCount < results.length, () =>
    setVisibleCount((c) => c + SEARCH_PAGE),
  );

  const search = async () => {
    searchAbort.current?.abort();
    const version = ++searchVersion.current;
    const term = q.trim();
    setResults([]);
    if (!term) return;
    setSearching(true);
    setSearched(false);
    const controller = new AbortController();
    searchAbort.current = controller;
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(term)}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (version !== searchVersion.current) return;
      if (!response.ok || result.error) {
        window.alert(
          apiErrorMessage(result, `검색 실패 (HTTP ${response.status})`),
        );
        return;
      }
      setResults(result.hits ?? []);
      setSearched(true);
      setVisibleCount(SEARCH_PAGE);
    } catch {
      if (version === searchVersion.current) {
        window.alert("검색 중 오류가 발생했어요");
      }
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  };

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
          if (!searching) void search();
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
            setResults([]);
            setSearching(false);
            setSearched(false);
            ++searchVersion.current;
            searchAbort.current?.abort();
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
          : searched
            ? results.length
              ? `검색 결과 ${results.length}곡`
              : "검색 결과가 없어요. 다른 검색어를 입력해보세요."
            : "검색 후 대기열에 추가할 수 있어요."}
      </p>
      <ul className="m-0 max-h-90 list-none overflow-y-auto p-0 [overscroll-behavior:contain]">
        {results.slice(0, visibleCount).map((h) => (
          <li
            className="flex items-center gap-2.5 border-t border-[var(--admin-panel-border)] py-3"
            key={h.trackId}
          >
            <img
              className="size-9 shrink-0 rounded-md object-cover"
              src={art(h.artworkUrl)}
              alt=""
            />
            <div className="min-w-0 flex-1">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                {h.trackName}
              </div>
              <div className="mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--admin-muted)]">
                {h.artistName}
              </div>
            </div>
            <button
              className={`${admin.button} ${admin.ghost} admin-button`}
              type="button"
              disabled={adding !== null}
              onClick={async () => {
                setAdding(h.trackId);
                try {
                  await onAdd(h);
                } finally {
                  setAdding(null);
                }
              }}
            >
              {adding === h.trackId ? "추가 중" : "추가"}
            </button>
          </li>
        ))}
        {results.length > visibleCount ? (
          <li
            className="flex justify-center border-b-0 py-3 text-[0.8rem] text-[var(--admin-muted)]"
            key="more"
            ref={moreRef}
          >
            ∨ 더 보기
          </li>
        ) : null}
      </ul>
    </section>
  );
}
