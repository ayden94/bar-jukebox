import { useCallback, useEffect, useState } from "react";
import type { TableRow } from "../types";

type QrTabProps = {
  api: (path: string, opts?: RequestInit) => Promise<Response>;
};

type PrintCard = { label: string; svg: string; url: string };

export function QrTab({ api }: QrTabProps) {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [qrCache, setQrCache] = useState<
    Record<number, { svg: string; url: string }>
  >({});
  const [qrOpenId, setQrOpenId] = useState<number | null>(null);
  const [printCards, setPrintCards] = useState<PrintCard[]>([]);

  const loadTables = useCallback(async () => {
    try {
      const r = await api("/api/admin/tables");
      if (r.ok) setTables((await r.json()).tables ?? []);
    } catch {}
  }, [api]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const createTable = async () => {
    const input = document.getElementById("table-label") as HTMLInputElement;
    await api("/api/admin/tables", {
      method: "POST",
      body: JSON.stringify({ label: input.value.trim() }),
    });
    input.value = "";
    loadTables();
  };

  const toggleQr = async (id: number) => {
    if (qrOpenId === id) {
      setQrOpenId(null);
      return;
    }
    if (!qrCache[id]) {
      const j = await (await api(`/api/admin/tables/${id}/qr`)).json();
      setQrCache((c) => ({ ...c, [id]: { svg: j.svg, url: j.url } }));
    }
    setQrOpenId(id);
  };

  const removeTable = async (id: number) => {
    if (!window.confirm("테이블을 삭제할까요? (인쇄된 QR도 무효가 돼요)"))
      return;
    await api(`/api/admin/tables/${id}`, { method: "DELETE" });
    loadTables();
  };

  const printAll = async () => {
    const cards: PrintCard[] = [];
    for (const t of tables) {
      const j = await (await api(`/api/admin/tables/${t.id}/qr`)).json();
      cards.push({ label: t.label, svg: j.svg, url: j.url });
    }
    setPrintCards(cards);
  };

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
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 서버가 생성한 신뢰할 수 있는 QR SVG */}
            <div dangerouslySetInnerHTML={{ __html: qr.svg }} />
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
    </>
  );
}
