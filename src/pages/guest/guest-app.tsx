import { useJukeboxSnapshot, useToast } from "../hooks";
import { useTheme } from "../theme";
import type { Snapshot } from "../types";
import { Hint } from "./hint";
import { NowPlayingArea } from "./now-playing";
import { SearchPanel } from "./search-panel";
import { TopBar } from "./top-bar";

function myActiveCount(
  queue: Snapshot["queue"],
  np: Snapshot["nowPlaying"],
): number {
  let count = queue.filter((s) => s.isMine).length;
  if (np?.song.isMine) count += 1;
  return count;
}

export function GuestApp({
  error,
  tableLabel,
}: {
  error?: string;
  tableLabel?: string;
}) {
  const [theme, setTheme] = useTheme();
  const { snap, refresh } = useJukeboxSnapshot(!error);
  const { toast, showToast } = useToast();

  const cancel = async (id: string) => {
    try {
      const r = await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      showToast(
        j.ok ? "신청을 취소했어요" : "취소할 수 없어요",
        j.ok ? "ok" : "err",
      );
      refresh();
    } catch {
      showToast("네트워크 오류", "err");
    }
  };

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2.5 text-center text-[0.95rem] text-[var(--sub)]">
        <div className="text-[2.4rem]" aria-hidden="true">
          ♪
        </div>
        <div>{error}</div>
      </div>
    );
  }

  const np = snap?.nowPlaying ?? null;
  const paused = snap?.requestsPaused ?? false;
  const queue = snap?.queue ?? [];
  const maxPerDevice = snap?.maxPerDevice ?? 1;
  const myCount = myActiveCount(queue, np);
  const atLimit = maxPerDevice > 0 && myCount >= maxPerDevice;

  return (
    <div className="guest mx-auto flex min-h-dvh max-w-160 flex-col overflow-x-hidden bg-[var(--bg)] px-5 pt-[env(safe-area-inset-top)] pb-[calc(104px+env(safe-area-inset-bottom))] text-[var(--guest-ink)] max-[420.001px]:px-4 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-3 [&_button:focus-visible]:outline-[var(--guest-accent)] [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-offset-3 [&_input:focus-visible]:outline-[var(--guest-accent)] [&_select:focus-visible]:outline-2 [&_select:focus-visible]:outline-offset-3 [&_select:focus-visible]:outline-[var(--guest-accent)]">
      <TopBar theme={theme} onThemeSelect={setTheme} tableLabel={tableLabel} />
      {paused ? (
        <div className="mb-2.5 rounded-[14px] bg-[var(--banner-pause-bg)] px-3.5 py-2.5 text-[0.85rem] leading-normal font-semibold text-[var(--banner-pause-text)] [overflow-wrap:anywhere]">
          지금은 곡 신청을 받고 있지 않아요
        </div>
      ) : null}
      {snap?.notice ? (
        <div className="mb-2.5 rounded-[14px] bg-[var(--banner-notice-bg)] px-3.5 py-2.5 text-[0.85rem] leading-normal font-semibold text-[var(--banner-notice-text)] [overflow-wrap:anywhere]">
          {snap.notice}
        </div>
      ) : null}
      <SearchPanel
        blocked={paused || atLimit}
        hint={<Hint paused={paused} atLimit={atLimit} />}
        onRequested={refresh}
        showToast={showToast}
      />
      <NowPlayingArea np={np} queue={queue} onCancel={cancel} />
      {toast ? (
        <div
          className="fixed right-[max(12px,calc((100vw-612px)/2))] bottom-[calc(100px+env(safe-area-inset-bottom))] left-[max(12px,calc((100vw-612px)/2))] z-50 rounded-[14px] bg-[var(--guest-surface)] px-4 py-[13px] text-center text-sm text-[var(--guest-ink)] shadow-[var(--guest-shadow)] transition-[opacity,transform] duration-300"
          role="status"
        >
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
