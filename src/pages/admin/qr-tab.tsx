import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiErrorMessage } from "../shared";
import type { TableRow } from "../types";

type QrTabProps = {
  api: (path: string, opts?: RequestInit) => Promise<Response>;
};

type PrintCard = { label: string; svg: string; url: string };

function QrSvg({ svg }: { svg: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function QrTab({ api }: QrTabProps) {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [qrCache, setQrCache] = useState<
    Record<number, { svg: string; url: string }>
  >({});
  const [qrOpenId, setQrOpenId] = useState<number | null>(null);
  const [printCards, setPrintCards] = useState<PrintCard[]>([]);
  const pending = useRef(new Set<string>());
  const run = async (key: string, action: () => Promise<void>) => {
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      await action();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "네트워크 오류");
    } finally {
      pending.current.delete(key);
    }
  };

  const loadTables = useCallback(async () => {
    const r = await api("/api/admin/tables");
    setTables((await r.json()).tables ?? []);
  }, [api]);

  useEffect(() => {
    loadTables().catch((error) =>
      window.alert(error instanceof Error ? error.message : "네트워크 오류"),
    );
  }, [loadTables]);

  const createTable = () =>
    run("create", async () => {
      const input = document.getElementById("table-label") as HTMLInputElement;
      const label = input.value.trim();
      const data = await (
        await api("/api/admin/tables", {
          method: "POST",
          body: JSON.stringify({ label }),
        })
      ).json();
      if (data.ok === false) {
        throw new Error(apiErrorMessage(data, "테이블을 추가하지 못했어요"));
      }
      if (input.value.trim() === label) input.value = "";
      await loadTables();
    });

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

  const removeTable = (id: number) =>
    run(`remove-${id}`, async () => {
      if (!window.confirm("테이블을 삭제할까요? (인쇄된 QR도 무효가 돼요)")) {
        return;
      }
      const data = await (
        await api(`/api/admin/tables/${id}`, { method: "DELETE" })
      ).json();
      if (data.ok === false) {
        throw new Error(apiErrorMessage(data, "테이블을 삭제하지 못했어요"));
      }
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
          onClick={() => toggleQr(t.id)}
        >
          QR 보기
        </button>
        <button
          className="btn danger"
          type="button"
          onClick={() => removeTable(t.id)}
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
            <QrSvg svg={qr.svg} />
            <div className="qurl">{qr.url}</div>
          </div>
        </li>,
      );
    }
    return rows;
  });

  return (
    <>
      <div className="qr-page">
        <h2>테이블 &amp; QR</h2>
        <div className="panel">
          <div className="field">
            <input
              id="table-label"
              placeholder="테이블 이름 (예: 테이블 1)"
              maxLength={30}
            />
            <button className="btn" type="button" onClick={createTable}>
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
            <button className="btn ghost" type="button" onClick={printAll}>
              🖨 테이블 QR 전체 인쇄
            </button>
          </div>
        </div>
      </div>
      {printCards.length
        ? createPortal(
            <div id="printArea">
              <div className="qcards">
                {printCards.map((c) => (
                  <div className="qcard" key={c.url}>
                    <h3>{c.label}</h3>
                    <QrSvg svg={c.svg} />
                    <div className="qhint">
                      📱 QR을 스캔해서 노래를 신청하세요
                    </div>
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
