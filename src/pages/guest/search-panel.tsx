import { type ReactNode, useRef, useState } from "react";
import { useInfiniteScroll } from "../hooks";
import { art, fmt, SEARCH_PAGE } from "../shared";
import type { SearchHit } from "../types";

type SearchPanelProps = {
  blocked: boolean;
  hint?: ReactNode;
  onRequested: () => void;
  showToast: (msg: string, kind: string) => void;
};

export function SearchPanel({
  blocked,
  hint,
  onRequested,
  showToast,
}: SearchPanelProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const moreRef = useInfiniteScroll(
    visibleCount < results.length,
    () => setVisibleCount((c) => c + SEARCH_PAGE),
    "400px 0px",
  );

  const doSearch = async (termArg?: string) => {
    const term = (termArg ?? q).trim();
    window.clearTimeout(searchTimer.current ?? undefined);
    if (!term) return;
    setSearching(true);
    try {
      const r = await (
        await fetch(`/api/search?q=${encodeURIComponent(term)}`)
      ).json();
      if (r.error) {
        showToast(r.error, "err");
        return;
      }
      if (!r.hits.length) {
        showToast("검색 결과가 없어요", "err");
        return;
      }
      setResults(r.hits);
      setVisibleCount(SEARCH_PAGE);
    } catch {
      showToast("검색 중 오류가 발생했어요", "err");
    } finally {
      setSearching(false);
    }
  };

  const onSearchInput = (value: string) => {
    setQ(value);
    window.clearTimeout(searchTimer.current ?? undefined);
    searchTimer.current = window.setTimeout(() => doSearch(value), 450);
  };

  const request = async (hit: SearchHit) => {
    const params = new URLSearchParams(window.location.search);
    try {
      const r = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...hit,
          tableId: Number(params.get("t")),
          tableSecret: params.get("k") ?? "",
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        showToast(j.error || "신청 실패", "err");
        return;
      }
      showToast("신청됐어요! 순서가 오면 틀어줄게요 🎧", "ok");
      onRequested();
    } catch {
      showToast("네트워크 오류", "err");
    }
  };

  return (
    <>
      <div className="searchwrap">
        <div className="field">
          <input
            id="q"
            type="search"
            placeholder="노래, 가수 검색"
            enterKeyHint="search"
            autoComplete="off"
            value={q}
            onChange={(e) =>
              onSearchInput((e.target as HTMLInputElement).value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
          />
          <button
            type="button"
            className="gobtn"
            onClick={() => doSearch()}
            disabled={searching}
          >
            검색
          </button>
        </div>
      </div>
      {hint}
      <ul className="results">
        {results.slice(0, visibleCount).map((h) => (
          <li key={h.trackId}>
            <img src={art(h.artworkUrl)} alt="" />
            <div className="info">
              <div className="t">{h.trackName}</div>
              <div className="a">{`${h.artistName}${h.durationSec ? ` · ${fmt(h.durationSec)}` : ""}`}</div>
            </div>
            <button
              type="button"
              className="req"
              disabled={blocked || searching}
              onClick={() => request(h)}
            >
              신청
            </button>
          </li>
        ))}
        {results.length > visibleCount ? (
          <li className="more" key="more" ref={moreRef}>
            ∨ 더 보기
          </li>
        ) : null}
      </ul>
    </>
  );
}
