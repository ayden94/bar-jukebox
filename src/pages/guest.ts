import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { themeScript, useTheme } from "./theme";

export type GuestDocumentProps = {
  readonly stylesheets: readonly string[];
  readonly tableLabel?: string;
  readonly error?: string;
};

type SongView = {
  id: string;
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  durationSec: number | null;
  requestedBy: string;
  deviceId: string | null;
};

type Snapshot = {
  nowPlaying: {
    song: SongView;
    positionSec: number;
    durationSec: number | null;
  } | null;
  queue: SongView[];
  requestsPaused: boolean;
  notice: string;
};

type SearchHit = {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
};

const art = (u: string): string =>
  u ? `/api/artwork?u=${encodeURIComponent(u)}` : u;

function fmt(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "-:--";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function deviceHasActive(snap: Snapshot, myDevice: string): boolean {
  if (!myDevice) return false;
  return (
    snap.nowPlaying?.song.deviceId === myDevice ||
    snap.queue.some((s) => s.deviceId === myDevice)
  );
}

export function GuestDocument({
  stylesheets,
  tableLabel,
  error,
}: GuestDocumentProps) {
  const routeUrl =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;

  return createElement(
    ReactClientRouterProvider,
    {
      initialSnapshot: createReactRouteSnapshot({ params: {}, url: routeUrl }),
    },
    createElement(
      "html",
      {
        "data-error": error ?? "",
        "data-page": "guest",
        "data-table-label": tableLabel ?? "",
        lang: "ko",
      },
      createElement(
        "head",
        null,
        createElement("meta", { charSet: "utf-8" }),
        createElement("meta", {
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
          name: "viewport",
        }),
        createElement("meta", { content: "#000000", name: "theme-color" }),
        createElement("meta", {
          name: "apple-mobile-web-app-capable",
          content: "yes",
        }),
        createElement("title", null, "바 주크박스"),
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
        createElement(GuestApp, { error, tableLabel }),
      ),
    ),
  );
}

function GuestApp({
  error,
  tableLabel,
}: {
  error?: string;
  tableLabel?: string;
}) {
  const [theme, toggleTheme] = useTheme();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(
    null,
  );
  const [myDevice, setMyDevice] = useState("");
  const searchTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string, kind: string) => {
    setToast({ msg, kind });
    window.clearTimeout(toastTimer.current ?? undefined);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      setSnap(await res.json());
    } catch {}
  }, []);

  // 실시간: SSE 구독, 실패 시 폴링 폴백
  useEffect(() => {
    if (error) return;
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
  }, [error, refresh]);

  // 기기 id 조회 (신청 버튼 상태/내 곡 판정용)
  useEffect(() => {
    if (error) return;
    const params = new URLSearchParams(window.location.search);
    fetch(
      `/api/table?t=${params.get("t")}&k=${encodeURIComponent(params.get("k") ?? "")}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setMyDevice(j.deviceId ?? "");
      })
      .catch(() => {});
  }, [error]);

  const doSearch = async (termArg?: string) => {
    const term = (termArg ?? q).trim();
    window.clearTimeout(searchTimer.current ?? undefined);
    if (!term) return;
    setSearching(true);
    try {
      const r = await (
        await fetch(`/api/search?q=${encodeURIComponent(term)}`)
      ).json();
      if (r.error) {
        showToast(r.error, "err");
        return;
      }
      if (!r.hits.length) {
        showToast("검색 결과가 없어요", "err");
        return;
      }
      setResults(r.hits);
    } catch {
      showToast("검색 중 오류가 발생했어요", "err");
    } finally {
      setSearching(false);
    }
  };

  const onSearchInput = (value: string) => {
    setQ(value);
    window.clearTimeout(searchTimer.current ?? undefined);
    searchTimer.current = window.setTimeout(() => doSearch(value), 450);
  };

  const request = async (hit: SearchHit) => {
    const params = new URLSearchParams(window.location.search);
    try {
      const r = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...hit,
          tableId: Number(params.get("t")),
          tableSecret: params.get("k") ?? "",
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        showToast(j.error || "신청 실패", "err");
        return;
      }
      showToast("신청됐어요! 순서가 오면 틀어줄게요 🎧", "ok");
      refresh();
    } catch {
      showToast("네트워크 오류", "err");
    }
  };

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
    return createElement(
      "div",
      { className: "boot" },
      createElement("div", { className: "logo" }, "🚫"),
      createElement("div", null, error),
    );
  }

  const np = snap?.nowPlaying ?? null;
  const npSong = np?.song ?? null;
  const paused = snap?.requestsPaused ?? false;
  const mine = deviceHasActive(
    snap ?? { nowPlaying: null, queue: [], requestsPaused: false, notice: "" },
    myDevice,
  );
  const queue = snap?.queue ?? [];
  const blocked = paused || mine;
  const dur = np ? (np.durationSec ?? npSong?.durationSec ?? null) : null;
  const progress = np && dur ? Math.min(100, (np.positionSec / dur) * 100) : 0;

  return createElement(
    "div",
    { className: "guest" },
    createElement(
      "header",
      { className: "top" },
      createElement(
        "div",
        { className: "brand" },
        createElement("span", { className: "note" }, "♪ "),
        "주크박스",
      ),
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
        createElement("div", { className: "chip" }, tableLabel ?? ""),
      ),
    ),
    paused
      ? createElement(
          "div",
          { className: "banner pause" },
          "지금은 곡 신청을 받고 있지 않아요",
        )
      : null,
    snap?.notice
      ? createElement(
          "div",
          { className: "banner notice" },
          `📢 ${snap.notice}`,
        )
      : null,
    createElement(
      "div",
      { className: "searchwrap" },
      createElement(
        "div",
        { className: "field" },
        createElement("input", {
          id: "q",
          type: "search",
          placeholder: "노래, 가수 검색",
          enterKeyHint: "search",
          autoComplete: "off",
          value: q,
          onChange: (e) => onSearchInput((e.target as HTMLInputElement).value),
          onKeyDown: (e) => {
            if (e.key === "Enter") doSearch();
          },
        }),
        createElement(
          "button",
          {
            type: "button",
            className: "gobtn",
            onClick: () => doSearch(),
            disabled: searching,
          },
          "검색",
        ),
      ),
    ),
    renderHint(paused, mine, snap),
    createElement(
      "ul",
      { className: "results" },
      results.map((h) =>
        createElement(
          "li",
          { key: h.trackId },
          createElement("img", { src: art(h.artworkUrl), alt: "" }),
          createElement(
            "div",
            { className: "info" },
            createElement("div", { className: "t" }, h.trackName),
            createElement(
              "div",
              { className: "a" },
              `${h.artistName}${h.durationSec ? ` · ${fmt(h.durationSec)}` : ""}`,
            ),
          ),
          createElement(
            "button",
            {
              type: "button",
              className: "req",
              disabled: blocked || searching,
              onClick: () => request(h),
            },
            "신청",
          ),
        ),
      ),
    ),
    np && npSong
      ? createElement(
          "button",
          {
            type: "button",
            className: "mini",
            onClick: () => setSheetOpen(true),
            "aria-label": "재생 화면 열기",
          },
          createElement("img", { src: art(npSong.artworkUrl), alt: "" }),
          createElement(
            "div",
            { className: "mi" },
            createElement("div", { className: "mt" }, npSong.trackName),
            createElement(
              "div",
              { className: "ma" },
              `${npSong.artistName} · ${npSong.requestedBy}`,
            ),
          ),
          createElement(
            "div",
            { className: "eq" },
            createElement("i"),
            createElement("i"),
            createElement("i"),
          ),
        )
      : null,
    createElement(
      "div",
      { className: `sheet${sheetOpen ? " open" : ""}` },
      createElement(
        "button",
        {
          type: "button",
          className: "grabber",
          onClick: () => setSheetOpen(false),
          "aria-label": "닫기",
        },
        "⌄",
      ),
      np && npSong
        ? createElement(
            "div",
            null,
            createElement(
              "div",
              { className: "nphead" },
              createElement("img", {
                className: "bigart",
                src: art(npSong.artworkUrl),
                alt: "",
              }),
              createElement("div", { className: "nplabel" }, "NOW PLAYING"),
              createElement("div", { className: "nptitle" }, npSong.trackName),
              createElement(
                "div",
                { className: "npartist" },
                npSong.artistName,
              ),
              createElement(
                "div",
                { className: "npby" },
                `${npSong.requestedBy}님이 신청`,
              ),
            ),
            createElement(
              "div",
              { className: "progress" },
              createElement("div", {
                className: "bar",
                style: { width: `${progress}%` },
              }),
            ),
            createElement(
              "div",
              { className: "times" },
              createElement("span", null, fmt(np.positionSec)),
              createElement(
                "span",
                null,
                fmt(np.durationSec ?? npSong.durationSec),
              ),
            ),
          )
        : createElement(
            "div",
            { className: "npempty" },
            "재생중인 곡이 없어요",
          ),
      createElement(
        "button",
        {
          type: "button",
          className: `qtoggle${queueOpen ? " exp" : ""}`,
          onClick: () => setQueueOpen(!queueOpen),
        },
        createElement(
          "span",
          { className: "left" },
          "재생 예정 ",
          createElement(
            "span",
            { className: "count" },
            queue.length ? `· ${queue.length}곡` : "",
          ),
        ),
        createElement("span", { className: "chev" }, "⌃"),
      ),
      queueOpen
        ? queue.length
          ? createElement(
              "ul",
              { className: "qlist show" },
              queue.map((s, i) => {
                const my = s.deviceId === myDevice;
                return createElement(
                  "li",
                  { key: s.id, className: my ? "mine" : "" },
                  createElement("span", { className: "idx" }, String(i + 1)),
                  createElement("img", { src: art(s.artworkUrl), alt: "" }),
                  createElement(
                    "div",
                    { className: "info" },
                    createElement("div", { className: "t" }, s.trackName),
                    createElement(
                      "div",
                      { className: "a" },
                      `${s.artistName} · ${s.requestedBy}`,
                    ),
                  ),
                  my
                    ? createElement(
                        "span",
                        { className: "minebadge" },
                        "내 신청",
                      )
                    : null,
                  my
                    ? createElement(
                        "button",
                        {
                          type: "button",
                          className: "cancelx",
                          onClick: () => cancel(s.id),
                          "aria-label": "신청 취소",
                        },
                        "✕",
                      )
                    : null,
                );
              }),
            )
          : createElement(
              "div",
              { className: "qempty show" },
              "대기열이 비었어요 — 첫 곡을 신청해보세요",
            )
        : null,
    ),
    toast
      ? createElement("div", { className: `toast ${toast.kind}` }, toast.msg)
      : null,
  );
}

function renderHint(
  paused: boolean,
  mine: boolean,
  snap: Snapshot | null,
): ReturnType<typeof createElement> | null {
  const text = paused
    ? "잠시 후에 곡 신청을 받아요"
    : mine
      ? "신청한 곡이 재생 대기 중이에요. 끝나면 또 신청할 수 있어요"
      : snap?.queue.length
        ? null
        : "신청하고 싶은 곡을 검색해보세요";
  if (!text) return null;
  return createElement("div", { className: "hint" }, text);
}
