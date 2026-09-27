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
  const searchAbort = useRef<AbortController | null>(null);
  const searchVersion = useRef(0);
  const canSearch = !searching && q.trim() !== "" && q.trim() !== searchedTerm;
  useEffect(
    () => () => {
      ++searchVersion.current;
      searchAbort.current?.abort();
    },
    [],
  );
  const requestPending = useRef(false);
  const moreRef = useInfiniteScroll(
    visibleCount < results.length,
    () => setVisibleCount((c) => c + SEARCH_PAGE),
    "400px 0px",
  );

  const doSearch = async () => {
    if (!canSearch) return;
    const term = q.trim();
    searchAbort.current?.abort();
    const version = ++searchVersion.current;
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
      <div className="m-0 [&_h1]:mt-1 [&_h1]:mb-2 [&_h1]:text-[clamp(1.45rem,5.5vw,1.75rem)] [&_h1]:leading-[1.3] [&_h1]:font-bold [&_h1]:tracking-[-0.055em] [&_h1]:text-balance">
        <h1>듣고 싶은 곡을 신청해요</h1>
      </div>
      <div className="sticky top-0 z-5 -mx-5 bg-[var(--bg)] px-5 py-3 max-[420.001px]:-mx-4 max-[420.001px]:px-4">
        <div className="flex gap-2">
          <input
            className="min-h-13 min-w-0 flex-1 rounded-[14px] border border-[var(--guest-stroke)] bg-[var(--guest-surface)] px-3.5 py-3 text-base text-[var(--guest-ink)] shadow-none outline-none placeholder:text-[var(--guest-muted)]"
            id="q"
            type="search"
            placeholder="노래나 가수를 검색해요"
            aria-label="노래나 가수 검색"
            enterKeyHint="search"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
          />
          <button
            type="button"
            className="min-h-13 min-w-17.5 cursor-pointer rounded-[14px] border-0 bg-[var(--guest-accent)] px-3 text-[0.95rem] font-bold text-[var(--guest-accent-ink)] transition-[transform,opacity] duration-[var(--guest-speed)] ease-[var(--guest-ease)] enabled:hover:brightness-112 enabled:active:scale-96 disabled:opacity-55 motion-reduce:duration-[1ms]"
            onClick={() => doSearch()}
            disabled={!canSearch}
          >
            {searching ? "검색 중" : "검색"}
          </button>
        </div>
      </div>
      {hint}
      <div
        className="my-1 min-h-6 text-[0.81rem] leading-normal font-semibold text-[var(--guest-muted)]"
        role="status"
        aria-live="polite"
      >
        {searching
          ? "곡을 찾고 있어요"
          : searchedTerm && results.length === 0
            ? "검색 결과가 없어요. 다른 노래나 가수를 검색해보세요"
            : results.length > 0
              ? `검색 결과 ${results.length}곡`
              : null}
      </div>
      <ul className="m-0 list-none p-0">
        {results.slice(0, visibleCount).map((h) => (
          <li
            className="flex min-w-0 items-center gap-[13px] border-b border-[var(--guest-stroke)] py-3"
            key={h.trackId}
          >
            <img
              className="size-14 shrink-0 rounded-[11px] bg-[var(--card-bg)] object-cover"
              src={art(h.artworkUrl)}
              alt=""
            />
            <div className="min-w-0 flex-1">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.95rem] leading-[1.35] font-semibold text-[var(--guest-ink)] [overflow-wrap:anywhere]">
                {h.trackName}
              </div>
              <div className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.78rem] leading-[1.4] text-[var(--guest-muted)]">
                {`${h.artistName}${
                  h.durationSec ? ` · ${fmt(h.durationSec)}` : ""
                }`}
              </div>
            </div>
            <button
              type="button"
              className="min-h-11 min-w-14 cursor-pointer rounded-xl border-0 bg-[var(--guest-accent)] px-2.5 text-[0.85rem] font-bold text-[var(--guest-accent-ink)] transition-[transform,background] duration-[var(--guest-speed)] ease-[var(--guest-ease)] enabled:hover:brightness-112 enabled:active:scale-96 disabled:opacity-55 disabled:bg-[color-mix(in_srgb,var(--guest-ink)_9%,var(--guest-surface))] disabled:text-[var(--guest-muted)] motion-reduce:duration-[1ms]"
              disabled={blocked || searching || requestedTrack !== null}
              onClick={() => request(h)}
            >
              {requestedTrack === String(h.trackId) ? "신청 중" : "신청"}
            </button>
          </li>
        ))}
        {results.length > visibleCount ? (
          <li
            className="flex justify-center border-b-0 py-3 text-[0.8rem] text-[var(--guest-muted)]"
            key="more"
            ref={moreRef}
          >
            ∨ 더 보기
          </li>
        ) : null}
      </ul>
    </>
  );
}
