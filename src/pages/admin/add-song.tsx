import { useEffect, useRef, useState } from "react";
import { useInfiniteScroll } from "../hooks";
import { apiErrorMessage, art, SEARCH_PAGE } from "../shared";
import type { SearchHit } from "../types";

type AddSongProps = {
  onAdd: (hit: SearchHit) => void;
};

export function AddSong({ onAdd }: AddSongProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE);
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
      setVisibleCount(SEARCH_PAGE);
    } catch {
      if (version === searchVersion.current) {
        window.alert("검색 중 오류가 발생했어요");
      }
    }
  };

  return (
    <div className="panel">
      <div className="field">
        <input
          id="admin-search"
          placeholder="노래 / 가수 검색"
          value={q}
          onChange={(e) => {
            setQ((e.target as HTMLInputElement).value);
            setResults([]);
            ++searchVersion.current;
            searchAbort.current?.abort();
          }}
          onKeyDown={async (e) => {
            if (e.key !== "Enter") return;
            await search();
          }}
        />
      </div>
      <ul className="searchres">
        {results.slice(0, visibleCount).map((h) => (
          <li key={h.trackId}>
            <img src={art(h.artworkUrl)} alt="" />
            <div className="info">
              <div className="t">{h.trackName}</div>
              <div className="a">{h.artistName}</div>
            </div>
            <button className="btn" type="button" onClick={() => onAdd(h)}>
              추가
            </button>
          </li>
        ))}
        {results.length > visibleCount ? (
          <li className="more" key="more" ref={moreRef}>
            ∨ 더 보기
          </li>
        ) : null}
      </ul>
    </div>
  );
}
