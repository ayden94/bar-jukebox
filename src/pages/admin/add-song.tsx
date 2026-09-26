import { useState } from "react";
import { useInfiniteScroll } from "../hooks";
import { art, SEARCH_PAGE } from "../shared";
import type { SearchHit } from "../types";

type AddSongProps = {
  onAdd: (hit: SearchHit) => void;
};

export function AddSong({ onAdd }: AddSongProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE);
  const moreRef = useInfiniteScroll(visibleCount < results.length, () =>
    setVisibleCount((c) => c + SEARCH_PAGE),
  );

  const search = async () => {
    const r = await (
      await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
    ).json();
    setResults(r.hits ?? []);
    setVisibleCount(SEARCH_PAGE);
  };

  return (
    <div className="panel">
      <div className="field">
        <input
          id="admin-search"
          placeholder="노래 / 가수 검색"
          value={q}
          onChange={(e) => setQ((e.target as HTMLInputElement).value)}
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
