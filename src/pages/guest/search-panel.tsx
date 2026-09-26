import { type ReactNode, useEffect, useRef, useState } from "react";
import { useInfiniteScroll } from "../hooks";
import { apiErrorMessage, art, fmt, SEARCH_PAGE } from "../shared";
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
  const [searchedTerm, setSearchedTerm] = useState("");
  const [requestedTrack, setRequestedTrack] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const searchVersion = useRef(0);
  useEffect(
    () => () => {
      ++searchVersion.current;
      searchAbort.current?.abort();
      window.clearTimeout(searchTimer.current ?? undefined);
    },
    [],
  );
  const requestPending = useRef(false);
  const moreRef = useInfiniteScroll(
    visibleCount < results.length,
    () => setVisibleCount((c) => c + SEARCH_PAGE),
    "400px 0px",
  );

  const doSearch = async (termArg?: string) => {
    const term = (termArg ?? q).trim();
    window.clearTimeout(searchTimer.current ?? undefined);
    searchAbort.current?.abort();
    const version = ++searchVersion.current;
    if (!term) {
      setResults([]);
      setSearching(false);
      setSearchedTerm("");
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setSearchedTerm("");
    setResults([]);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(term)}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (version !== searchVersion.current) return;
      if (!response.ok || result.error) {
        showToast(
          apiErrorMessage(result, `검색 실패 (HTTP ${response.status})`),
          "err",
        );
        return;
      }
      setResults(result.hits ?? []);
      setSearchedTerm(term);
      setVisibleCount(SEARCH_PAGE);
    } catch {
      if (version === searchVersion.current) {
        showToast("검색 중 오류가 발생했어요", "err");
      }
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  };

  const onSearchInput = (value: string) => {
    setQ(value);
    setSearchedTerm("");
    setSearching(false);
    setResults([]);
    ++searchVersion.current;
    searchAbort.current?.abort();
    window.clearTimeout(searchTimer.current ?? undefined);
    if (value.trim()) {
      searchTimer.current = window.setTimeout(() => doSearch(value), 450);
    }
  };

  const request = async (hit: SearchHit) => {
    if (requestPending.current) return;
    requestPending.current = true;
    setRequestedTrack(String(hit.trackId));
    const params = new URLSearchParams(window.location.search);
    try {
      const r = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: hit.trackId,
          tableId: Number(params.get("t")),
          tableSecret: params.get("k") ?? "",
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        showToast(apiErrorMessage(j, "신청 실패"), "err");
        return;
      }
      showToast("신청됐어요. 순서가 오면 틀어줄게요", "ok");
      onRequested();
    } catch {
      showToast("네트워크 오류", "err");
    } finally {
      requestPending.current = false;
      setRequestedTrack(null);
    }
  };

  return (
    <>
      <div className="searchintro">
        <span className="eyebrow">오늘의 선곡</span>
        <h1>듣고 싶은 곡을 신청해요</h1>
        <p>노래나 가수를 찾아 신청해보세요</p>
      </div>
      <div className="searchwrap">
        <div className="field">
          <input
            id="q"
            type="search"
            placeholder="노래나 가수를 검색해요"
            aria-label="노래나 가수 검색"
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
            {searching ? "검색 중" : "검색"}
          </button>
        </div>
      </div>
      {hint}
      <div className="resultstatus" role="status" aria-live="polite">
        {searching
          ? "곡을 찾고 있어요"
          : searchedTerm && results.length === 0
            ? "검색 결과가 없어요. 다른 노래나 가수를 검색해보세요"
            : results.length > 0
              ? `검색 결과 ${results.length}곡`
              : null}
      </div>
      <ul className="results">
        {results.slice(0, visibleCount).map((h) => (
          <li key={h.trackId}>
            <img src={art(h.artworkUrl)} alt="" />
            <div className="info">
              <div className="t">{h.trackName}</div>
              <div className="a">
                {`${h.artistName}${
                  h.durationSec ? ` · ${fmt(h.durationSec)}` : ""
                }`}
              </div>
            </div>
            <button
              type="button"
              className="req"
              disabled={blocked || searching || requestedTrack !== null}
              onClick={() => request(h)}
            >
              {requestedTrack === String(h.trackId) ? "신청 중" : "신청"}
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
