import { useEffect, useState } from "react";
import { useJukeboxSnapshot, useToast } from "../hooks";
import { useTheme } from "../theme";
import type { Snapshot } from "../types";
import { Hint } from "./hint";
import { NowPlayingArea } from "./now-playing";
import { SearchPanel } from "./search-panel";
import { TopBar } from "./top-bar";

function deviceHasActive(snap: Snapshot, myDevice: string): boolean {
  if (!myDevice) return false;
  return (
    snap.nowPlaying?.song.deviceId === myDevice ||
    snap.queue.some((s) => s.deviceId === myDevice)
  );
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
  const [myDevice, setMyDevice] = useState("");

  useEffect(() => {
    if (error) return;
    const params = new URLSearchParams(window.location.search);
    fetch(
      `/api/table?t=${params.get("t")}&k=${encodeURIComponent(
        params.get("k") ?? "",
      )}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setMyDevice(j.deviceId ?? "");
      })
      .catch(() => {});
  }, [error]);

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
        <div className="logo">🚫</div>
        <div>{error}</div>
      </div>
    );
  }

  const np = snap?.nowPlaying ?? null;
  const paused = snap?.requestsPaused ?? false;
  const queue = snap?.queue ?? [];
  const mine = deviceHasActive(
    snap ?? {
      nowPlaying: null,
      queue: [],
      history: [],
      requestsPaused: false,
      notice: "",
    },
    myDevice,
  );

  return (
    <div className="guest">
      <TopBar theme={theme} onThemeSelect={setTheme} tableLabel={tableLabel} />
      {paused ? (
        <div className="banner pause">지금은 곡 신청을 받고 있지 않아요</div>
      ) : null}
      {snap?.notice ? (
        <div className="banner notice">{`📢 ${snap.notice}`}</div>
      ) : null}
      <SearchPanel
        blocked={paused || mine}
        hint={<Hint paused={paused} mine={mine} hasQueue={queue.length > 0} />}
        onRequested={refresh}
        showToast={showToast}
      />
      <NowPlayingArea
        np={np}
        queue={queue}
        myDevice={myDevice}
        onCancel={cancel}
      />
      {toast ? <div className={`toast ${toast.kind}`}>{toast.msg}</div> : null}
    </div>
  );
}
