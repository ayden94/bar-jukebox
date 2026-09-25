import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
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

  return createElement(
    ReactClientRouterProvider,
    {
      initialSnapshot: createReactRouteSnapshot({ params: {}, url: routeUrl }),
    },
    createElement(
      "html",
      { suppressHydrationWarning: true, "data-page": "admin", lang: "ko" },
      createElement(
        "head",
        null,
        createElement("meta", { charSet: "utf-8" }),
        createElement("meta", {
          content: "width=device-width, initial-scale=1",
          name: "viewport",
        }),
        createElement("title", null, "주크박스 관리"),
        createElement("script", {
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 저장된 테마를 첫 페인트 전에 적용하는 고정 스크립트
          dangerouslySetInnerHTML: { __html: themeScript },
        }),
        ...stylesheets.map((href) =>
          createElement("link", {
            "data-vite-style": true,
            href,
            key: href,
            rel: "stylesheet",
          }),
        ),
      ),
      createElement(
        "body",
        null,
        createElement(
          "div",
          { className: "admin-root" },
          createElement(AdminApp),
        ),
      ),
    ),
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

  const songRow = (s: SongView, draggable: boolean) =>
    createElement(
      "li",
      {
        key: s.id,
        draggable,
        onDragStart: draggable ? () => (dragIdRef.current = s.id) : undefined,
        onDragOver: draggable
          ? (e) => {
              e.preventDefault();
              setDragOverId(s.id);
            }
          : undefined,
        onDragEnd: draggable ? () => setDragOverId(null) : undefined,
        onDrop: draggable
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
          : undefined,
        className: draggable ? (dragOverId === s.id ? "dragover" : "") : "",
      },
      draggable ? createElement("span", { className: "grip" }, "⠿") : null,
      createElement("img", { src: art(s.artworkUrl), alt: "" }),
      createElement(
        "div",
        { className: "info" },
        createElement("div", { className: "t" }, s.trackName),
        createElement("div", { className: "a" }, s.artistName),
      ),
      createElement("span", { className: "by" }, s.requestedBy),
      draggable
        ? createElement(
            "button",
            {
              className: "del",
              type: "button",
              onClick: () => act("/api/admin/remove", { id: s.id }),
            },
            "✕",
          )
        : null,
    );

  if (!authed) {
    return createElement(
      "div",
      { className: "admin-root" },
      createElement(
        "div",
        { className: "gate" },
        createElement("h1", null, "🔒 주크박스 관리"),
        createElement("input", {
          type: "password",
          placeholder: "관리자 비밀번호",
          value: tokenInput,
          onChange: (e) => setTokenInput((e.target as HTMLInputElement).value),
        }),
        createElement(
          "button",
          { className: "btn", onClick: login, type: "button" },
          "들어가기",
        ),
        createElement(
          "div",
          { className: "note" },
          "비밀번호는 서버 .env의 ADMIN_TOKEN입니다.",
        ),
      ),
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
      createElement(
        "li",
        { key: String(t.id) },
        createElement(
          "div",
          { className: "tlabel" },
          t.label,
          createElement("small", null, ` #${t.id}`),
        ),
        createElement(
          "button",
          {
            className: "btn ghost",
            type: "button",
            onClick: async () => {
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
            },
          },
          "QR 보기",
        ),
        createElement(
          "button",
          {
            className: "btn danger",
            type: "button",
            onClick: async () => {
              if (
                !window.confirm(
                  "테이블을 삭제할까요? (인쇄된 QR도 무효가 돼요)",
                )
              )
                return;
              await api(`/api/admin/tables/${t.id}`, { method: "DELETE" });
              loadTables();
            },
          },
          "삭제",
        ),
      ),
    ];
    const qr = qrOpenId === t.id ? qrCache[t.id] : undefined;
    if (qr) {
      rows.push(
        createElement(
          "li",
          { key: `qr-${t.id}` },
          createElement(
            "div",
            { className: "qrbox" },
            createElement("div", {
              // biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG
              dangerouslySetInnerHTML: { __html: qr.svg },
            }),
            createElement("div", { className: "qurl" }, qr.url),
          ),
        ),
      );
    }
    return rows;
  });

  const tabBtn = (id: "songs" | "qr", label: string) =>
    createElement(
      "button",
      {
        className: `tab${activeTab === id ? " active" : ""}`,
        type: "button",
        onClick: () => switchTab(id),
      },
      label,
    );

  return createElement(
    "div",
    { className: "admin-root" },
    createElement(
      "div",
      { className: "topbar" },
      createElement("h1", null, "주크박스 관리"),
      createElement(
        "div",
        { className: "topright" },
        createElement(
          "button",
          {
            className: "themebtn",
            onClick: toggleTheme,
            type: "button",
            "aria-label": "테마 전환",
          },
          theme === "light" ? "🌙" : "☀️",
        ),
      ),
    ),
    createElement(
      "div",
      { className: "tabbar" },
      tabBtn("songs", "🎵 노래 관리"),
      tabBtn("qr", "🔲 QR 관리"),
    ),
    activeTab === "songs"
      ? createElement(
          "div",
          { className: "wrap" },
          createElement(
            "div",
            null,
            createElement("h2", null, "지금 재생중"),
            createElement(
              "div",
              { className: "panel" },
              createElement(
                "div",
                { className: "now" },
                npSong
                  ? [
                      createElement("img", {
                        src: art(npSong.artworkUrl),
                        key: "art",
                      }),
                      createElement(
                        "div",
                        { key: "info" },
                        createElement("div", { className: "label" }, "재생중"),
                        createElement(
                          "div",
                          { className: "title" },
                          npSong.trackName,
                        ),
                        createElement(
                          "div",
                          { className: "artist" },
                          `${npSong.artistName} · ${npSong.requestedBy}`,
                        ),
                      ),
                    ]
                  : createElement(
                      "div",
                      { className: "empty" },
                      "재생중인 곡이 없어요",
                    ),
              ),
              np
                ? createElement(
                    "div",
                    { className: "progress" },
                    createElement("div", {
                      className: "bar",
                      style: { width: `${progressPct}%` },
                    }),
                  )
                : null,
              createElement(
                "div",
                { className: "skiprow" },
                createElement(
                  "button",
                  {
                    className: "btn danger",
                    disabled: !np,
                    onClick: () => act("/api/admin/skip"),
                    type: "button",
                  },
                  "⏭ 스킵 (다음 곡으로)",
                ),
              ),
            ),
            createElement("h2", null, "대기열"),
            createElement(
              "div",
              { className: "panel" },
              createElement(
                "ul",
                { className: "queue" },
                queue.map((s) => songRow(s, true)),
              ),
              queue.length
                ? null
                : createElement(
                    "div",
                    { className: "empty" },
                    "대기열이 비었어요",
                  ),
            ),
            createElement("h2", null, "최근 재생"),
            createElement(
              "div",
              { className: "panel" },
              createElement(
                "ul",
                { className: "queue" },
                history.map((s) => songRow(s, false)),
              ),
              history.length
                ? null
                : createElement("div", { className: "empty" }, "기록이 없어요"),
            ),
          ),
          createElement(
            "div",
            null,
            createElement("h2", null, "곡 추가 (제한 없음)"),
            createElement(
              "div",
              { className: "panel" },
              createElement(
                "div",
                { className: "field" },
                createElement("input", {
                  id: "admin-search",
                  placeholder: "노래 / 가수 검색",
                  value: q,
                  onChange: (e) => setQ((e.target as HTMLInputElement).value),
                  onKeyDown: async (e) => {
                    if (e.key !== "Enter") return;
                    const r = await (
                      await fetch(
                        `/api/search?q=${encodeURIComponent(q.trim())}`,
                      )
                    ).json();
                    setSearchResults(r.hits ?? []);
                  },
                }),
              ),
              createElement(
                "ul",
                { className: "searchres" },
                searchResults.map((h) =>
                  createElement(
                    "li",
                    { key: h.trackId },
                    createElement("img", { src: art(h.artworkUrl), alt: "" }),
                    createElement(
                      "div",
                      { className: "info" },
                      createElement("div", { className: "t" }, h.trackName),
                      createElement("div", { className: "a" }, h.artistName),
                    ),
                    createElement(
                      "button",
                      {
                        className: "btn",
                        type: "button",
                        onClick: () => act("/api/admin/add", h),
                      },
                      "추가",
                    ),
                  ),
                ),
              ),
            ),
            createElement("h2", null, "운영 설정"),
            createElement(
              "div",
              { className: "panel" },
              createElement(
                "div",
                { className: "settingrow" },
                createElement("label", null, "곡 신청"),
                createElement(
                  "button",
                  {
                    className: paused ? "btn danger" : "btn okstate",
                    type: "button",
                    onClick: () =>
                      act("/api/admin/settings", { requestsPaused: !paused }),
                  },
                  paused ? "일시중지 중" : "받는 중",
                ),
              ),
              createElement(
                "div",
                { className: "settingrow" },
                createElement("label", null, "공지"),
                createElement("input", {
                  id: "notice-input",
                  placeholder: "손님 화면에 표시할 공지 (비우면 숨김)",
                  maxLength: 200,
                  value: noticeInput,
                  onChange: (e) =>
                    setNoticeInput((e.target as HTMLInputElement).value),
                }),
                createElement(
                  "button",
                  {
                    className: "btn",
                    type: "button",
                    onClick: () =>
                      act("/api/admin/settings", {
                        notice: noticeInput.trim(),
                      }),
                  },
                  "저장",
                ),
              ),
              createElement(
                "div",
                { className: "note" },
                "신청을 일시중지하면 손님 화면에 안내가 표시되고 신청이 차단돼요. 바텐더의 곡 추가는 언제나 가능해요.",
              ),
            ),
          ),
        )
      : createElement(
          "div",
          { className: "qr-page" },
          createElement("h2", null, "테이블 & QR"),
          createElement(
            "div",
            { className: "panel" },
            createElement(
              "div",
              { className: "field" },
              createElement("input", {
                id: "table-label",
                placeholder: "테이블 이름 (예: 테이블 1)",
                maxLength: 30,
              }),
              createElement(
                "button",
                {
                  className: "btn",
                  type: "button",
                  onClick: async () => {
                    const input = document.getElementById(
                      "table-label",
                    ) as HTMLInputElement;
                    await api("/api/admin/tables", {
                      method: "POST",
                      body: JSON.stringify({ label: input.value.trim() }),
                    });
                    input.value = "";
                    loadTables();
                  },
                },
                "추가",
              ),
            ),
            createElement("ul", { className: "tablelist" }, tableRows),
            createElement(
              "div",
              {
                className: "empty",
                style: { display: tables.length ? "none" : "block" },
              },
              "테이블이 없어요 — 추가하고 QR을 인쇄하세요",
            ),
            createElement(
              "div",
              { style: { marginTop: "12px" } },
              createElement(
                "button",
                {
                  className: "btn ghost",
                  type: "button",
                  onClick: async () => {
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
                  },
                },
                "🖨 테이블 QR 전체 인쇄",
              ),
            ),
          ),
        ),
    printCards.length
      ? createElement(
          "div",
          { id: "printArea" },
          createElement(
            "div",
            { className: "qcards" },
            printCards.map((c) =>
              createElement(
                "div",
                { className: "qcard", key: c.url },
                createElement("h3", null, c.label),
                createElement("div", {
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG
                  dangerouslySetInnerHTML: { __html: c.svg },
                }),
                createElement(
                  "div",
                  { className: "qhint" },
                  "📱 QR을 스캔해서 노래를 신청하세요",
                ),
                createElement("div", { className: "qurl" }, c.url),
              ),
            ),
          ),
        )
      : null,
  );
}

const art = (u: string): string =>
  u ? `/api/artwork?u=${encodeURIComponent(u)}` : u;
