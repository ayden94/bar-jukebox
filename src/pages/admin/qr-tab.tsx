import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { apiErrorMessage } from "../shared";
import type { TableRow } from "../types";
import { admin } from "./styles";

type QrTabProps = {
  api: (path: string, opts?: RequestInit) => Promise<Response>;
};

type PrintCard = { label: string; svg: string; url: string };

type LoadState = "loading" | "ready" | "error";

function QrSvg({ svg, framed = false }: { svg: string; framed?: boolean }) {
  return (
    <div
      className={
        framed
          ? "rounded-lg bg-white p-2 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
          : undefined
      }
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function QrTab({ api }: QrTabProps) {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [label, setLabel] = useState("");
  const [qrCache, setQrCache] = useState<
    Record<number, { svg: string; url: string }>
  >({});
  const [qrOpenId, setQrOpenId] = useState<number | null>(null);
  const [printCards, setPrintCards] = useState<PrintCard[]>([]);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  const pending = useRef(new Set<string>());
  const run = async (key: string, action: () => Promise<void>) => {
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      await action();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "네트워크 오류");
    } finally {
      pending.current.delete(key);
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const loadTables = useCallback(async () => {
    const r = await api("/api/admin/tables");
    setTables((await r.json()).tables ?? []);
    setLoadState("ready");
  }, [api]);

  useEffect(() => {
    setLoadState("loading");
    loadTables().catch((error) => {
      setLoadState("error");
      window.alert(error instanceof Error ? error.message : "네트워크 오류");
    });
  }, [loadTables]);

  const createTable = (event: FormEvent) => {
    event.preventDefault();
    const next = label.trim();
    if (!next) return;
    run("create", async () => {
      const data = await (
        await api("/api/admin/tables", {
          method: "POST",
          body: JSON.stringify({ label: next }),
        })
      ).json();
      if (data.ok === false) {
        throw new Error(apiErrorMessage(data, "테이블을 추가하지 못했어요"));
      }
      setLabel((cur) => (cur.trim() === next ? "" : cur));
      await loadTables();
    });
  };

  const toggleQr = (id: number) =>
    run(`qr-${id}`, async () => {
      if (qrOpenId === id) {
        setQrOpenId(null);
        return;
      }
      if (!qrCache[id]) {
        const j = await (await api(`/api/admin/tables/${id}/qr`)).json();
        setQrCache((c) => ({ ...c, [id]: { svg: j.svg, url: j.url } }));
      }
      setQrOpenId(id);
    });

  const removeTable = (table: TableRow) =>
    run(`remove-${table.id}`, async () => {
      if (
        !window.confirm(
          `${table.label} 테이블을 삭제할까요? (인쇄된 QR도 무효가 돼요)`,
        )
      ) {
        return;
      }
      const data = await (
        await api(`/api/admin/tables/${table.id}`, { method: "DELETE" })
      ).json();
      if (data.ok === false) {
        throw new Error(apiErrorMessage(data, "테이블을 삭제하지 못했어요"));
      }
      if (qrOpenId === table.id) setQrOpenId(null);
      await loadTables();
    });

  const printAll = () =>
    run("print", async () => {
      if (!tables.length) return;
      const cards: PrintCard[] = [];
      for (const t of tables) {
        const j = await (await api(`/api/admin/tables/${t.id}/qr`)).json();
        cards.push({ label: t.label, svg: j.svg, url: j.url });
      }
      setPrintCards(cards);
    });

  useEffect(() => {
    if (!printCards.length) return;
    document.body.classList.add("printing");
    window.print();
    document.body.classList.remove("printing");
    return () => document.body.classList.remove("printing");
  }, [printCards]);

  const creating = busyKeys.has("create");
  const printing = busyKeys.has("print");
  const emptyText =
    loadState === "loading"
      ? "테이블 목록을 불러오는 중이에요"
      : loadState === "error"
        ? "테이블 목록을 불러오지 못했어요"
        : "등록된 테이블이 없어요 — 테이블을 추가하고 QR을 인쇄하세요";

  const tableRows = tables.map((t) => {
    const expanded = qrOpenId === t.id;
    const qr = expanded ? qrCache[t.id] : undefined;
    const detailsId = `qr-details-${t.id}`;
    const qrLoading = busyKeys.has(`qr-${t.id}`);
    const removing = busyKeys.has(`remove-${t.id}`);
    return (
      <li
        className="border-t border-[var(--admin-panel-border)] py-4.5 first:border-t-0 first:pt-0"
        key={String(t.id)}
      >
        <div className="flex items-center gap-3.5 max-[640.001px]:flex-wrap">
          <div
            className="grid size-10.5 shrink-0 place-items-center rounded-[10px] bg-[var(--admin-input-bg)] text-[0.8rem] text-[var(--admin-muted)] tabular-nums max-[640.001px]:size-9.5"
            aria-hidden="true"
          >
            {t.id}
          </div>
          <div className="min-w-0 flex-1 font-[650] [overflow-wrap:anywhere]">
            {t.label}
          </div>
          <div className="flex shrink-0 gap-2 max-[640.001px]:w-full max-[640.001px]:justify-end">
            <button
              aria-controls={detailsId}
              aria-expanded={expanded}
              className={`${admin.button} ${admin.ghost} admin-button`}
              disabled={qrLoading}
              onClick={() => toggleQr(t.id)}
              type="button"
            >
              {expanded
                ? "QR 숨기기"
                : qrLoading
                  ? "QR 불러오는 중이에요"
                  : "QR 보기"}
            </button>
            <button
              aria-label={`${t.label} 테이블 삭제`}
              className={`${admin.button} ${admin.danger} admin-button`}
              disabled={removing}
              onClick={() => removeTable(t)}
              type="button"
            >
              {removing ? "삭제 중이에요" : "삭제"}
            </button>
          </div>
        </div>
        {qr ? (
          <div className="min-w-0" id={detailsId}>
            <div className="mt-4 grid grid-cols-[180px_minmax(0,1fr)] items-center gap-6 rounded-xl bg-[var(--admin-input-bg)] p-5 max-[960.001px]:grid-cols-[minmax(0,1fr)] max-[640.001px]:gap-4 max-[640.001px]:p-4 max-[960.001px]:[&>div:first-child]:mx-auto max-[960.001px]:[&>div:first-child]:w-45 max-[960.001px]:[&>div:first-child]:max-w-full">
              <QrSvg svg={qr.svg} framed={true} />
              <div>
                <strong>{t.label}</strong>
                <p className={admin.note}>
                  이 QR을 스캔하면 이 테이블의 신청 화면으로 이동해요.
                </p>
                <a
                  className={`${admin.button} ${admin.ghost} admin-button mt-3`}
                  href={qr.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  신청 화면 열기
                </a>
                <div className="mt-2.5 text-xs leading-[1.7] text-[var(--admin-muted)] [overflow-wrap:anywhere]">
                  {qr.url}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </li>
    );
  });

  return (
    <>
      <div className={admin.pageHead}>
        <div>
          <h1>테이블 &amp; QR</h1>
          <p className={admin.note}>
            테이블마다 QR을 인쇄해 두면 손님이 스캔해서 노래를 신청할 수 있어요.
          </p>
        </div>
        <button
          className={`${admin.button} ${admin.ghost} admin-button`}
          disabled={!tables.length || printing}
          onClick={printAll}
          type="button"
        >
          {printing ? "인쇄 준비 중이에요" : "테이블 QR 전체 인쇄"}
        </button>
      </div>
      <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-[var(--admin-gap)] max-[960.001px]:grid-cols-[260px_minmax(0,1fr)] max-[640.001px]:grid-cols-[minmax(0,1fr)]">
        <section className={admin.panel}>
          <div className={admin.panelHead}>
            <h2>테이블 추가</h2>
          </div>
          <form onSubmit={createTable}>
            <label className={admin.fieldLabel} htmlFor="table-label">
              테이블 이름
            </label>
            <div className={admin.field}>
              <input
                disabled={creating}
                id="table-label"
                maxLength={30}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 창가 1번"
                type="text"
                value={label}
              />
              <button
                className={`${admin.button} admin-button`}
                disabled={!label.trim() || creating}
                type="submit"
              >
                {creating ? "추가 중이에요" : "추가"}
              </button>
            </div>
            <p className={admin.note}>이름은 QR 인쇄물에 함께 표시돼요.</p>
          </form>
        </section>
        <section className={admin.panel}>
          <div className={admin.panelHead}>
            <h2>테이블 목록</h2>
            <span className={admin.count}>{`등록 ${tables.length}개`}</span>
          </div>
          <ul className="m-0 list-none p-0">{tableRows}</ul>
          {tableRows.length ? null : (
            <div className={admin.empty}>{emptyText}</div>
          )}
        </section>
      </div>
      {printCards.length
        ? createPortal(
            <div id="printArea">
              <div className="qcards">
                {printCards.map((c) => (
                  <div className="qcard" key={c.url}>
                    <h3>{c.label}</h3>
                    <QrSvg svg={c.svg} />
                    <div className="qhint">QR을 스캔해서 노래를 신청하세요</div>
                    <div className="qurl">{c.url}</div>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
