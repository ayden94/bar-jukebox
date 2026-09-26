import { Link } from "@fluojs/react/client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useJukeboxSnapshot } from "../hooks";
import { apiErrorMessage } from "../shared";
import { useTheme } from "../theme";
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
  { href: "/admin/songs", id: "songs", label: "노래 관리" },
  { href: "/admin/qr", id: "qr", label: "테이블 · QR" },
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
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const { snap, refresh } = useJukeboxSnapshot(authed);
  const pending = useRef(new Set<string>());
  const loginPending = useRef(false);

  const api = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const res = await fetch(path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
      });
      if (res.status === 401) {
        window.localStorage.removeItem("bj_admin");
        setToken("");
        setAuthed(false);
      }
      if (!res.ok) {
        const data = await res
          .clone()
          .json()
          .catch(() => null);
        throw new Error(
          apiErrorMessage(data, `요청 실패 (HTTP ${res.status})`),
        );
      }
      return res;
    },
    [token],
  );

  useEffect(() => {
    const saved =
      typeof window === "undefined"
        ? ""
        : (window.localStorage.getItem("bj_admin") ?? "");
    if (!saved) return;
    setToken(saved);
    fetch("/api/admin/tables", { headers: { "x-admin-token": saved } })
      .then((r) => {
        if (r.ok) setAuthed(true);
        else if (r.status === 401) {
          window.localStorage.removeItem("bj_admin");
        } else setLoginError(`관리자 연결 실패 (HTTP ${r.status})`);
      })
      .catch(() => setLoginError("관리자 연결에 실패했어요"));
  }, []);

  // 해시(#qr) 시절 북마크를 실제 라우트로 넘긴다.
  useEffect(() => {
    if (window.location.hash === "#qr") {
      window.location.replace("/admin/qr");
    }
  }, []);

  const login = async () => {
    if (loginPending.current) return;
    loginPending.current = true;
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch("/api/admin/tables", {
        headers: { "x-admin-token": tokenInput },
      });
      if (!res.ok) {
        setLoginError(
          res.status === 401
            ? "비밀번호가 틀렸어요"
            : `로그인 실패 (HTTP ${res.status})`,
        );
        return;
      }
      window.localStorage.setItem("bj_admin", tokenInput);
      setToken(tokenInput);
      setAuthed(true);
    } catch {
      setLoginError("관리자 연결에 실패했어요");
    } finally {
      loginPending.current = false;
      setLoggingIn(false);
    }
  };

  const act = async (path: string, body?: unknown, method = "POST") => {
    const key = `${method} ${path} ${JSON.stringify(body)}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      const res = await api(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (data?.ok === false) {
        throw new Error(apiErrorMessage(data, "요청을 완료하지 못했어요"));
      }
      await refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "네트워크 오류");
    } finally {
      pending.current.delete(key);
    }
  };

  if (!authed) {
    return (
      <AuthGate
        onLogin={login}
        onTokenInput={setTokenInput}
        tokenInput={tokenInput}
        pending={loggingIn}
        error={loginError}
      />
    );
  }

  return (
    <div className="admin-root">
      <div className="admin-shell">
        <header className="topbar">
          <div className="admin-brand">
            <span aria-hidden="true">♪</span> 주크박스 <small>관리자</small>
          </div>
          <nav className="tabbar" aria-label="관리자 메뉴">
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
          </nav>
          <div className="topright">
            <span
              className={`reception-status${
                snap?.requestsPaused ? " paused" : ""
              }`}
            >
              {snap
                ? snap.requestsPaused
                  ? "접수 중지"
                  : "접수 중"
                : "연결 중"}
            </span>
            <select
              className="admin-theme"
              aria-label="테마 선택"
              value={theme}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "light" || value === "dark" || value === "system")
                  setTheme(value);
              }}
            >
              <option value="system">시스템</option>
              <option value="light">밝게</option>
              <option value="dark">어둡게</option>
            </select>
          </div>
        </header>
        <AdminSessionContext.Provider value={{ act, api, snap }}>
          <main>{children}</main>
        </AdminSessionContext.Provider>
      </div>
    </div>
  );
}
