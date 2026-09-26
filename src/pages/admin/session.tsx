import { Link } from "@fluojs/react/client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useJukeboxSnapshot } from "../hooks";
import { useTheme } from "../theme";
import { ThemeSegment } from "../theme-segment";
import type { Snapshot } from "../types";
import { AuthGate } from "./auth-gate";

export type AdminTabId = "songs" | "qr";

type AdminSessionValue = {
  readonly act: (
    path: string,
    body?: unknown,
    method?: string,
  ) => Promise<void>;
  readonly api: (path: string, opts?: RequestInit) => Promise<Response>;
  readonly snap: Snapshot | null;
};

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function useAdminSession(): AdminSessionValue {
  const value = useContext(AdminSessionContext);
  if (value === null) {
    throw new Error("AdminSession 안에서만 useAdminSession을 쓸 수 있어요");
  }
  return value;
}

const TABS: ReadonlyArray<{ href: string; id: AdminTabId; label: string }> = [
  { href: "/admin/songs", id: "songs", label: "🎵 노래 관리" },
  { href: "/admin/qr", id: "qr", label: "🔲 QR 관리" },
];

export function AdminSession({
  active,
  children,
}: {
  active: AdminTabId;
  children: ReactNode;
}) {
  const [theme, setTheme] = useTheme();
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
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

  // 해시(#qr) 시절 북마크를 실제 라우트로 넘긴다.
  useEffect(() => {
    if (window.location.hash === "#qr") {
      window.location.replace("/admin/qr");
    }
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

  if (!authed) {
    return (
      <AuthGate
        onLogin={login}
        onTokenInput={setTokenInput}
        tokenInput={tokenInput}
      />
    );
  }

  return (
    <div className="admin-root">
      <div className="topbar">
        <h1>주크박스 관리</h1>
        <div className="topright">
          <ThemeSegment onSelect={setTheme} theme={theme} />
        </div>
      </div>
      <div className="tabbar">
        {TABS.map((tab) => (
          <Link
            aria-current={active === tab.id ? "page" : undefined}
            className={`tab${active === tab.id ? " active" : ""}`}
            href={tab.href}
            key={tab.id}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <AdminSessionContext.Provider value={{ act, api, snap }}>
        {children}
      </AdminSessionContext.Provider>
    </div>
  );
}
