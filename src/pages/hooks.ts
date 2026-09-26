import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

export function useJukeboxSnapshot(enabled: boolean) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const version = useRef(0);
  const active = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const response = await fetch("/api/state");
      if (!response.ok) return;
      const data = (await response.json()) as Snapshot;
      if (active.current && current === version.current) setSnap(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    let poll: number | null = null;
    // EventSource reconnects on its own; polling covers the disconnected window.
    const es = new EventSource("/api/events");
    const stopPoll = () => {
      if (poll !== null) window.clearInterval(poll);
      poll = null;
    };
    es.onopen = stopPoll;
    es.addEventListener("state", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as Snapshot;
        ++version.current;
        setSnap(data);
        stopPoll();
      } catch {}
    });
    es.onerror = () => {
      if (poll === null) {
        void refresh();
        poll = window.setInterval(refresh, 3000);
      }
    };
    return () => {
      active.current = false;
      ++version.current;
      es.close();
      stopPoll();
    };
  }, [enabled, refresh]);

  return { snap, refresh };
}

export function useToast(durationMs = 3000) {
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(
    null,
  );
  const timer = useRef<number | null>(null);
  const showToast = useCallback(
    (msg: string, kind: string) => {
      setToast({ msg, kind });
      window.clearTimeout(timer.current ?? undefined);
      timer.current = window.setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  return { toast, showToast };
}

export function useInfiniteScroll(
  hasMore: boolean,
  loadMore: () => void,
  rootMargin = "200px 0px",
) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, rootMargin]);
  return ref;
}
