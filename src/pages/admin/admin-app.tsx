import { useCallback, useEffect, useState } from "react";
import { useJukeboxSnapshot } from "../hooks";
import { useTheme } from "../theme";
import { ThemeSegment } from "../theme-segment";
import { AuthGate } from "./auth-gate";
import { QrTab } from "./qr-tab";
import { SongsTab } from "./songs-tab";

export function AdminApp() {
  const [theme, setTheme] = useTheme();
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activeTab, setActiveTab] = useState<"songs" | "qr">("songs");
  const { snap, refresh } = useJukeboxSnapshot(authed);

  const api = useCallback(
    (path: string, opts: RequestInit = {}) =>
      fetch(path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
      }),
    [token],
  );

  useEffect(() => {
    const saved =
      typeof window === "undefined"
        ? ""
        : (window.localStorage.getItem("bj_admin") ?? "");
    if (!saved) return;
    setToken(saved);
    fetch("/api/admin/tables", { headers: { "x-admin-token": saved } }).then(
      (r) => {
        if (r.ok) setAuthed(true);
        else window.localStorage.removeItem("bj_admin");
      },
    );
  }, []);

  useEffect(() => {
    const sync = () =>
      setActiveTab(window.location.hash === "#qr" ? "qr" : "songs");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const login = async () => {
    const res = await fetch("/api/admin/tables", {
      headers: { "x-admin-token": tokenInput },
    });
    if (res.status === 401) {
      window.alert("비밀번호가 틀렸어요");
      return;
    }
    window.localStorage.setItem("bj_admin", tokenInput);
    setToken(tokenInput);
    setAuthed(true);
  };

  const act = async (path: string, body?: unknown, method = "POST") => {
    await api(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    refresh();
  };

  const switchTab = (t: "songs" | "qr") => {
    window.location.hash = t === "qr" ? "#qr" : "#songs";
    setActiveTab(t);
  };

  if (!authed) {
    return (
      <AuthGate
        tokenInput={tokenInput}
        onTokenInput={setTokenInput}
        onLogin={login}
      />
    );
  }

  const tabBtn = (id: "songs" | "qr", label: string) => (
    <button
      className={`tab${activeTab === id ? " active" : ""}`}
      type="button"
      onClick={() => switchTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="admin-root">
      <div className="topbar">
        <h1>주크박스 관리</h1>
        <div className="topright">
          <ThemeSegment theme={theme} onSelect={setTheme} />
        </div>
      </div>
      <div className="tabbar">
        {tabBtn("songs", "🎵 노래 관리")}
        {tabBtn("qr", "🔲 QR 관리")}
      </div>
      {activeTab === "songs" ? (
        <SongsTab snap={snap} act={act} />
      ) : (
        <QrTab api={api} />
      )}
    </div>
  );
}
