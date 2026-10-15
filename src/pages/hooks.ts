import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getBrowserSnapshotStore, getServerSnapshot } from "./snapshot-store";

export function useJukeboxSnapshot(enabled: boolean) {
  const store = getBrowserSnapshotStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled || !store) return () => {};
      return store.subscribe(listener);
    },
    [enabled, store],
  );
  const snap = useSyncExternalStore(
    subscribe,
    enabled && store ? store.getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
  const refresh = useCallback(async () => {
    if (enabled && store) await store.refresh();
  }, [enabled, store]);

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
