import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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

const SEARCH_PAGE = 20;

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

  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot({ params: {}, url: routeUrl })}
    >
      <html
        data-error={error ?? ""}
        data-page="guest"
        data-table-label={tableLabel ?? ""}
        lang="ko"
      >
        <head>
          <meta charSet="utf-8" />
          <meta
            content="width=device-width, initial-scale=1, viewport-fit=cover"
            name="viewport"
          />
          <meta content="#000000" name="theme-color" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <title>바 주크박스</title>
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
          <GuestApp error={error} tableLabel={tableLabel} />
        </body>
      </html>
    </ReactClientRouterProvider>
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
  const [visibleCount, setVisibleCount] = useState(SEARCH_PAGE);
  const moreRef = useRef<HTMLLIElement | null>(null);
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

  // 검색 결과 무한 스크롤: 센티널이 화면 근처로 오면 다음 페이지 노출
  useEffect(() => {
    const el = moreRef.current;
    if (!el || visibleCount >= results.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setVisibleCount((c) => c + SEARCH_PAGE);
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results, visibleCount]);

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
      setVisibleCount(SEARCH_PAGE);
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
    return (
      <div className="boot">
        <div className="logo">🚫</div>
        <div>{error}</div>
      </div>
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

  return (
    <div className="guest">
      <header className="top">
        <div className="brand">
          <span className="note">{"♪ "}</span>주크박스
        </div>
        <div className="topright">
          <button
            className="themebtn"
            onClick={toggleTheme}
            type="button"
            aria-label="테마 전환"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          <div className="chip">{tableLabel ?? ""}</div>
        </div>
      </header>
      {paused ? (
        <div className="banner pause">지금은 곡 신청을 받고 있지 않아요</div>
      ) : null}
      {snap?.notice ? (
        <div className="banner notice">{`📢 ${snap.notice}`}</div>
      ) : null}
      <div className="searchwrap">
        <div className="field">
          <input
            id="q"
            type="search"
            placeholder="노래, 가수 검색"
            enterKeyHint="search"
            autoComplete="off"
            value={q}
            onChange={(e) =>
              onSearchInput((e.target as HTMLInputElement).value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
          />
          <button
            type="button"
            className="gobtn"
            onClick={() => doSearch()}
            disabled={searching}
          >
            검색
          </button>
        </div>
      </div>
      {renderHint(paused, mine, snap)}
      <ul className="results">
        {results.slice(0, visibleCount).map((h) => (
          <li key={h.trackId}>
            <img src={art(h.artworkUrl)} alt="" />
            <div className="info">
              <div className="t">{h.trackName}</div>
              <div className="a">{`${h.artistName}${h.durationSec ? ` · ${fmt(h.durationSec)}` : ""}`}</div>
            </div>
            <button
              type="button"
              className="req"
              disabled={blocked || searching}
              onClick={() => request(h)}
            >
              신청
            </button>
          </li>
        ))}
        {results.length > visibleCount ? (
          <li className="more" key="more" ref={moreRef}>
            ∨ 더 보기
          </li>
        ) : null}
      </ul>
      {np && npSong ? (
        <button
          type="button"
          className="mini"
          onClick={() => setSheetOpen(true)}
          aria-label="재생 화면 열기"
        >
          <img src={art(npSong.artworkUrl)} alt="" />
          <div className="mi">
            <div className="mt">{npSong.trackName}</div>
            <div className="ma">{`${npSong.artistName} · ${npSong.requestedBy}`}</div>
          </div>
          <div className="eq">
            <i />
            <i />
            <i />
          </div>
        </button>
      ) : null}
      <div className={`sheet${sheetOpen ? " open" : ""}`}>
        <button
          type="button"
          className="grabber"
          onClick={() => setSheetOpen(false)}
          aria-label="닫기"
        >
          ⌄
        </button>
        {np && npSong ? (
          <div>
            <div className="nphead">
              <img className="bigart" src={art(npSong.artworkUrl)} alt="" />
              <div className="nplabel">NOW PLAYING</div>
              <div className="nptitle">{npSong.trackName}</div>
              <div className="npartist">{npSong.artistName}</div>
              <div className="npby">{`${npSong.requestedBy}님이 신청`}</div>
            </div>
            <div className="progress">
              <div className="bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="times">
              <span>{fmt(np.positionSec)}</span>
              <span>{fmt(np.durationSec ?? npSong.durationSec)}</span>
            </div>
          </div>
        ) : (
          <div className="npempty">재생중인 곡이 없어요</div>
        )}
        <button
          type="button"
          className={`qtoggle${queueOpen ? " exp" : ""}`}
          onClick={() => setQueueOpen(!queueOpen)}
        >
          <span className="left">
            {"재생 예정 "}
            <span className="count">
              {queue.length ? `· ${queue.length}곡` : ""}
            </span>
          </span>
          <span className="chev">⌃</span>
        </button>
        {queueOpen ? (
          queue.length ? (
            <ul className="qlist show">
              {queue.map((s, i) => {
                const my = s.deviceId === myDevice;
                return (
                  <li key={s.id} className={my ? "mine" : ""}>
                    <span className="idx">{String(i + 1)}</span>
                    <img src={art(s.artworkUrl)} alt="" />
                    <div className="info">
                      <div className="t">{s.trackName}</div>
                      <div className="a">{`${s.artistName} · ${s.requestedBy}`}</div>
                    </div>
                    {my ? <span className="minebadge">내 신청</span> : null}
                    {my ? (
                      <button
                        type="button"
                        className="cancelx"
                        onClick={() => cancel(s.id)}
                        aria-label="신청 취소"
                      >
                        ✕
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="qempty show">
              대기열이 비었어요 — 첫 곡을 신청해보세요
            </div>
          )
        ) : null}
      </div>
      {toast ? <div className={`toast ${toast.kind}`}>{toast.msg}</div> : null}
    </div>
  );
}

function renderHint(
  paused: boolean,
  mine: boolean,
  snap: Snapshot | null,
): ReactNode | null {
  const text = paused
    ? "잠시 후에 곡 신청을 받아요"
    : mine
      ? "신청한 곡이 재생 대기 중이에요. 끝나면 또 신청할 수 있어요"
      : snap?.queue.length
        ? null
        : "신청하고 싶은 곡을 검색해보세요";
  if (!text) return null;
  return <div className="hint">{text}</div>;
}
