import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { themeScript, useTheme } from "./theme";

export type AdminDocumentProps = {
  readonly stylesheets: readonly string[];
};

type SongView = {
  id: string;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  requestedBy: string;
  durationSec: number | null;
};

type Snapshot = {
  nowPlaying: {
    song: SongView;
    positionSec: number;
    durationSec: number | null;
  } | null;
  queue: SongView[];
  history: SongView[];
  requestsPaused: boolean;
  notice: string;
};

type TableRow = { id: number; label: string; url: string };

const SEARCH_PAGE = 20;
type SearchHit = {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
};

export function AdminDocument({ stylesheets }: AdminDocumentProps) {
  const routeUrl =
    typeof window === "undefined"
      ? "/admin"
      : `${window.location.pathname}${window.location.search}`;

  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot({ params: {}, url: routeUrl })}
    >
      <html suppressHydrationWarning={true} data-page="admin" lang="ko">
        <head>
          <meta charSet="utf-8" />
          <meta content="width=device-width, initial-scale=1" name="viewport" />
          <title>주크박스 관리</title>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 저장된 테마를 첫 페인트 전에 적용하는 고정 스크립트 */}
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
          {stylesheets.map((href) => (
            <link
              data-vite-style={true}
              href={href}
              key={href}
              rel="stylesheet"
            />
          ))}
        </head>
        <body>
          <div className="admin-root">
            <AdminApp />
          </div>
        </body>
      </html>
    </ReactClientRouterProvider>
  );
}

function AdminApp() {
  const [theme, toggleTheme] = useTheme();
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [activeTab, setActiveTab] = useState<"songs" | "qr">("songs");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [qrCache, setQrCache] = useState<
    Record<number, { svg: string; url: string }>
  >({});
  const [qrOpenId, setQrOpenId] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE);
  const moreRef = useRef<HTMLLIElement | null>(null);
  const [q, setQ] = useState("");
  const [noticeInput, setNoticeInput] = useState("");
  const [paused, setPaused] = useState(false);
  const [printCards, setPrintCards] = useState<
    Array<{ label: string; svg: string; url: string }>
  >([]);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const api = useCallback(
    (path: string, opts: RequestInit = {}) =>
      fetch(path, {
        ...opts,
        headers: { "Content-Type": "application/json", "x-admin-token": token },
      }),
    [token],
  );

  // 검색 결과 무한 스크롤: 센티널이 보이면 다음 페이지 노출
  useEffect(() => {
    const el = moreRef.current;
    if (!el || visibleCount >= searchResults.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setVisibleCount((c) => c + SEARCH_PAGE);
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [searchResults, visibleCount]);

  const refresh = useCallback(async () => {
    try {
      setSnap(await (await fetch("/api/state")).json());
    } catch {}
  }, []);

  const loadTables = useCallback(async () => {
    try {
      const r = await api("/api/admin/tables");
      if (r.ok) setTables((await r.json()).tables ?? []);
    } catch {}
  }, [api]);

  useEffect(() => {
    if (!authed) return;
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
    loadTables();
    return () => {
      es.close();
      if (poll) window.clearInterval(poll);
    };
  }, [authed, refresh, loadTables]);

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

  // 탭을 URL 해시와 동기화 (/admin#qr → QR 관리)
  useEffect(() => {
    const sync = () =>
      setActiveTab(window.location.hash === "#qr" ? "qr" : "songs");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!snap) return;
    setPaused(snap.requestsPaused);
  }, [snap]);

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

  const songRow = (s: SongView, draggable: boolean) => (
    <li
      key={s.id}
      draggable={draggable}
      onDragStart={draggable ? () => (dragIdRef.current = s.id) : undefined}
      onDragOver={
        draggable
          ? (e) => {
              e.preventDefault();
              setDragOverId(s.id);
            }
          : undefined
      }
      onDragEnd={draggable ? () => setDragOverId(null) : undefined}
      onDrop={
        draggable
          ? async (e) => {
              e.preventDefault();
              if (!dragIdRef.current || !snap) return;
              const ids = snap.queue.map((x) => x.id);
              const from = ids.indexOf(dragIdRef.current);
              const to = ids.indexOf(s.id);
              if (from >= 0 && to >= 0) {
                ids.splice(to, 0, ...ids.splice(from, 1));
                await api("/api/admin/reorder", {
                  method: "POST",
                  body: JSON.stringify({ ids }),
                });
              }
              dragIdRef.current = null;
              setDragOverId(null);
              refresh();
            }
          : undefined
      }
      className={draggable ? (dragOverId === s.id ? "dragover" : "") : ""}
    >
      {draggable ? <span className="grip">⠿</span> : null}
      <img src={art(s.artworkUrl)} alt="" />
      <div className="info">
        <div className="t">{s.trackName}</div>
        <div className="a">{s.artistName}</div>
      </div>
      <span className="by">{s.requestedBy}</span>
      {draggable ? (
        <button
          className="del"
          type="button"
          onClick={() => act("/api/admin/remove", { id: s.id })}
        >
          ✕
        </button>
      ) : null}
    </li>
  );

  if (!authed) {
    return (
      <div className="admin-root">
        <div className="gate">
          <h1>🔒 주크박스 관리</h1>
          <input
            type="password"
            placeholder="관리자 비밀번호"
            value={tokenInput}
            onChange={(e) =>
              setTokenInput((e.target as HTMLInputElement).value)
            }
          />
          <button className="btn" onClick={login} type="button">
            들어가기
          </button>
          <div className="note">비밀번호는 서버 .env의 ADMIN_TOKEN입니다.</div>
        </div>
      </div>
    );
  }

  const np = snap?.nowPlaying ?? null;
  const npSong = np?.song ?? null;
  const queue = snap?.queue ?? [];
  const history = snap?.history ?? [];
  const progressPct =
    np && (np.durationSec ?? npSong?.durationSec)
      ? Math.min(
          100,
          (np.positionSec / (np.durationSec ?? npSong?.durationSec ?? 1)) * 100,
        )
      : 0;

  const tableRows = tables.flatMap((t) => {
    const rows = [
      <li key={String(t.id)}>
        <div className="tlabel">
          {t.label}
          <small>{` #${t.id}`}</small>
        </div>
        <button
          className="btn ghost"
          type="button"
          onClick={async () => {
            if (qrOpenId === t.id) {
              setQrOpenId(null);
              return;
            }
            if (!qrCache[t.id]) {
              const j = await (
                await api(`/api/admin/tables/${t.id}/qr`)
              ).json();
              setQrCache((c) => ({
                ...c,
                [t.id]: { svg: j.svg, url: j.url },
              }));
            }
            setQrOpenId(t.id);
          }}
        >
          QR 보기
        </button>
        <button
          className="btn danger"
          type="button"
          onClick={async () => {
            if (
              !window.confirm("테이블을 삭제할까요? (인쇄된 QR도 무효가 돼요)")
            )
              return;
            await api(`/api/admin/tables/${t.id}`, { method: "DELETE" });
            loadTables();
          }}
        >
          삭제
        </button>
      </li>,
    ];
    const qr = qrOpenId === t.id ? qrCache[t.id] : undefined;
    if (qr) {
      rows.push(
        <li key={`qr-${t.id}`}>
          <div className="qrbox">
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG */}
            <div dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="qurl">{qr.url}</div>
          </div>
        </li>,
      );
    }
    return rows;
  });

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
          <button
            className="themebtn"
            onClick={toggleTheme}
            type="button"
            aria-label="테마 전환"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
        </div>
      </div>
      <div className="tabbar">
        {tabBtn("songs", "🎵 노래 관리")}
        {tabBtn("qr", "🔲 QR 관리")}
      </div>
      {activeTab === "songs" ? (
        <div className="wrap">
          <div>
            <h2>지금 재생중</h2>
            <div className="panel">
              <div className="now">
                {npSong ? (
                  [
                    <img src={art(npSong.artworkUrl)} alt="" key="art" />,
                    <div key="info">
                      <div className="label">재생중</div>
                      <div className="title">{npSong.trackName}</div>
                      <div className="artist">{`${npSong.artistName} · ${npSong.requestedBy}`}</div>
                    </div>,
                  ]
                ) : (
                  <div className="empty">재생중인 곡이 없어요</div>
                )}
              </div>
              {np ? (
                <div className="progress">
                  <div className="bar" style={{ width: `${progressPct}%` }} />
                </div>
              ) : null}
              <div className="skiprow">
                <button
                  className="btn danger"
                  disabled={!np}
                  onClick={() => act("/api/admin/skip")}
                  type="button"
                >
                  ⏭ 스킵 (다음 곡으로)
                </button>
              </div>
            </div>
            <h2>대기열</h2>
            <div className="panel">
              <ul className="queue">{queue.map((s) => songRow(s, true))}</ul>
              {queue.length ? null : (
                <div className="empty">대기열이 비었어요</div>
              )}
            </div>
            <h2>최근 재생</h2>
            <div className="panel">
              <ul className="queue">{history.map((s) => songRow(s, false))}</ul>
              {history.length ? null : (
                <div className="empty">기록이 없어요</div>
              )}
            </div>
          </div>
          <div>
            <h2>곡 추가 (제한 없음)</h2>
            <div className="panel">
              <div className="field">
                <input
                  id="admin-search"
                  placeholder="노래 / 가수 검색"
                  value={q}
                  onChange={(e) => setQ((e.target as HTMLInputElement).value)}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    const r = await (
                      await fetch(
                        `/api/search?q=${encodeURIComponent(q.trim())}`,
                      )
                    ).json();
                    setSearchResults(r.hits ?? []);
                    setVisibleCount(SEARCH_PAGE);
                  }}
                />
              </div>
              <ul className="searchres">
                {searchResults.slice(0, visibleCount).map((h) => (
                  <li key={h.trackId}>
                    <img src={art(h.artworkUrl)} alt="" />
                    <div className="info">
                      <div className="t">{h.trackName}</div>
                      <div className="a">{h.artistName}</div>
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => act("/api/admin/add", h)}
                    >
                      추가
                    </button>
                  </li>
                ))}
                {searchResults.length > visibleCount ? (
                  <li className="more" key="more" ref={moreRef}>
                    ∨ 더 보기
                  </li>
                ) : null}
              </ul>
            </div>
            <h2>운영 설정</h2>
            <div className="panel">
              <div className="settingrow">
                <span className="rowname">곡 신청</span>
                <button
                  className={paused ? "btn danger" : "btn okstate"}
                  type="button"
                  onClick={() =>
                    act("/api/admin/settings", { requestsPaused: !paused })
                  }
                >
                  {paused ? "일시중지 중" : "받는 중"}
                </button>
              </div>
              <div className="settingrow">
                <label htmlFor="notice-input">공지</label>
                <input
                  id="notice-input"
                  placeholder="손님 화면에 표시할 공지 (비우면 숨김)"
                  maxLength={200}
                  value={noticeInput}
                  onChange={(e) =>
                    setNoticeInput((e.target as HTMLInputElement).value)
                  }
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    act("/api/admin/settings", {
                      notice: noticeInput.trim(),
                    })
                  }
                >
                  저장
                </button>
              </div>
              <div className="note">
                신청을 일시중지하면 손님 화면에 안내가 표시되고 신청이 차단돼요.
                바텐더의 곡 추가는 언제나 가능해요.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="qr-page">
          <h2>테이블 &amp; QR</h2>
          <div className="panel">
            <div className="field">
              <input
                id="table-label"
                placeholder="테이블 이름 (예: 테이블 1)"
                maxLength={30}
              />
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  const input = document.getElementById(
                    "table-label",
                  ) as HTMLInputElement;
                  await api("/api/admin/tables", {
                    method: "POST",
                    body: JSON.stringify({ label: input.value.trim() }),
                  });
                  input.value = "";
                  loadTables();
                }}
              >
                추가
              </button>
            </div>
            <ul className="tablelist">{tableRows}</ul>
            <div
              className="empty"
              style={{ display: tables.length ? "none" : "block" }}
            >
              테이블이 없어요 — 추가하고 QR을 인쇄하세요
            </div>
            <div style={{ marginTop: "12px" }}>
              <button
                className="btn ghost"
                type="button"
                onClick={async () => {
                  const cards: Array<{
                    label: string;
                    svg: string;
                    url: string;
                  }> = [];
                  for (const t of tables) {
                    const j = await (
                      await api(`/api/admin/tables/${t.id}/qr`)
                    ).json();
                    cards.push({ label: t.label, svg: j.svg, url: j.url });
                  }
                  setPrintCards(cards);
                }}
              >
                🖨 테이블 QR 전체 인쇄
              </button>
            </div>
          </div>
        </div>
      )}
      {printCards.length ? (
        <div id="printArea">
          <div className="qcards">
            {printCards.map((c) => (
              <div className="qcard" key={c.url}>
                <h3>{c.label}</h3>
                {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG */}
                <div dangerouslySetInnerHTML={{ __html: c.svg }} />
                <div className="qhint">📱 QR을 스캔해서 노래를 신청하세요</div>
                <div className="qurl">{c.url}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const art = (u: string): string =>
  u ? `/api/artwork?u=${encodeURIComponent(u)}` : u;
