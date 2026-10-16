import { useEffect, useRef, useState } from "react";
import { apiErrorMessage, trackKey } from "./shared";
import type { SearchPage, TrackMetadata } from "./types";

export function useTrackSearch(onError: (message: string) => void) {
  const [results, setResults] = useState<TrackMetadata[]>([]);
  const [searchedTerm, setSearchedTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const clear = () => {
    request.current?.abort();
    request.current = null;
    setResults([]);
    setSearchedTerm("");
    setNextCursor(null);
    setSearching(false);
    setLoadingMore(false);
    setPageError(false);
  };

  const fetchPage = async (term: string, cursor: string | null) => {
    if (cursor !== null && request.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPageError(false);
    if (cursor === null) {
      setResults([]);
      setSearchedTerm("");
      setNextCursor(null);
      setSearching(true);
      setLoadingMore(false);
    } else {
      setLoadingMore(true);
    }
    try {
      const params = new URLSearchParams({ q: term });
      if (cursor !== null) params.set("cursor", cursor);
      const response = await fetch(`/api/search?${params}`, {
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        throw new Error(
          apiErrorMessage(body, `검색 실패 (HTTP ${response.status})`),
        );
      }
      const page: SearchPage = body;
      setResults((previous) => [
        ...new Map(
          [...(cursor === null ? [] : previous), ...page.hits].map((hit) => [
            trackKey(hit.ref),
            hit,
          ]),
        ).values(),
      ]);
      setNextCursor(page.nextCursor);
      setSearchedTerm(term);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (cursor !== null) setPageError(true);
        onError(
          error instanceof Error ? error.message : "검색 중 오류가 발생했어요",
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setSearching(false);
        setLoadingMore(false);
      }
    }
  };

  return {
    results,
    searchedTerm,
    searching,
    loadingMore,
    pageError,
    hasMore: nextCursor !== null,
    clear,
    search: (term: string) => {
      const query = term.trim();
      if (query) return fetchPage(query, null);
      clear();
    },
    loadMore: () => {
      if (nextCursor !== null) return fetchPage(searchedTerm, nextCursor);
    },
  };
}
