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
      <div className="boot">
        <div className="logo" aria-hidden="true">
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
    <div className="guest">
      <TopBar theme={theme} onThemeSelect={setTheme} tableLabel={tableLabel} />
      {paused ? (
        <div className="banner pause">지금은 곡 신청을 받고 있지 않아요</div>
      ) : null}
      {snap?.notice ? <div className="banner notice">{snap.notice}</div> : null}
      <SearchPanel
        blocked={paused || atLimit}
        hint={<Hint paused={paused} atLimit={atLimit} />}
        onRequested={refresh}
        showToast={showToast}
      />
      <NowPlayingArea np={np} queue={queue} onCancel={cancel} />
      {toast ? (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}
