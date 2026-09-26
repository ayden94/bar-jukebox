import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "./types";

export function useJukeboxSnapshot(enabled: boolean) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const refresh = useCallback(async () => {
    try {
      setSnap(await (await fetch("/api/state")).json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let poll: number | null = null;
    const es = new EventSource("/api/events");
    es.addEventListener("state", (e) => {
      try {
        setSnap(JSON.parse((e as MessageEvent).data));
      } catch {}
    });
    es.onerror = () => {
      es.close();
      if (!poll) poll = window.setInterval(refresh, 3000);
    };
    return () => {
      es.close();
      if (poll) window.clearInterval(poll);
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
