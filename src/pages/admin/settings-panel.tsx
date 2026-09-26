import { useEffect, useState } from "react";

type SettingsPatch = {
  requestsPaused?: boolean;
  notice?: string;
  maxPerDevice?: number;
  maxPerTable?: number;
};

type SettingsPanelProps = {
  requestsPaused: boolean;
  notice?: string;
  maxPerDevice: number;
  maxPerTable: number;
  onSave: (patch: SettingsPatch) => void;
};

export function SettingsPanel({
  requestsPaused,
  notice,
  maxPerDevice,
  maxPerTable,
  onSave,
}: SettingsPanelProps) {
  const [noticeInput, setNoticeInput] = useState(notice ?? "");
  const [noticeDirty, setNoticeDirty] = useState(false);

  useEffect(() => {
    if (notice === undefined) return;
    if (noticeDirty && notice === noticeInput) setNoticeDirty(false);
    else if (!noticeDirty) setNoticeInput(notice);
  }, [notice, noticeDirty, noticeInput]);
  const [deviceLimit, setDeviceLimit] = useState(String(maxPerDevice));
  const [tableLimit, setTableLimit] = useState(String(maxPerTable));

  useEffect(() => {
    setDeviceLimit(String(maxPerDevice));
    setTableLimit(String(maxPerTable));
  }, [maxPerDevice, maxPerTable]);

  const saveLimits = () => {
    const d = Number(deviceLimit);
    const t = Number(tableLimit);
    if (
      !Number.isInteger(d) ||
      d < 0 ||
      d > 99 ||
      !Number.isInteger(t) ||
      t < 0 ||
      t > 99
    ) {
      window.alert("곡 수 제한은 0~99 사이 숫자여야 해요 (0은 무제한)");
      return;
    }
    onSave({ maxPerDevice: d, maxPerTable: t });
  };

  return (
    <div className="panel">
      <div className="settingrow">
        <span className="rowname">곡 신청</span>
        <button
          className={requestsPaused ? "btn danger" : "btn okstate"}
          type="button"
          onClick={() => onSave({ requestsPaused: !requestsPaused })}
        >
          {requestsPaused ? "일시중지 중" : "받는 중"}
        </button>
      </div>
      <div className="settingrow">
        <label htmlFor="notice-input">공지</label>
        <input
          id="notice-input"
          placeholder="손님 화면에 표시할 공지 (비우면 숨김)"
          maxLength={200}
          value={noticeInput}
          onChange={(e) => {
            setNoticeDirty(true);
            setNoticeInput((e.target as HTMLInputElement).value);
          }}
        />
        <button
          className="btn"
          type="button"
          onClick={() => {
            const trimmed = noticeInput.trim();
            setNoticeInput(trimmed);
            onSave({ notice: trimmed });
          }}
        >
          저장
        </button>
      </div>
      <div className="settingrow">
        <label htmlFor="limit-device">기기당 최대</label>
        <input
          id="limit-device"
          type="number"
          min={0}
          max={99}
          inputMode="numeric"
          value={deviceLimit}
          onChange={(e) => setDeviceLimit((e.target as HTMLInputElement).value)}
        />
        <label htmlFor="limit-table">테이블당 최대</label>
        <input
          id="limit-table"
          type="number"
          min={0}
          max={99}
          inputMode="numeric"
          value={tableLimit}
          onChange={(e) => setTableLimit((e.target as HTMLInputElement).value)}
        />
        <button className="btn" type="button" onClick={saveLimits}>
          저장
        </button>
      </div>
      <div className="note">
        신청을 일시중지하면 손님 화면에 안내가 표시되고 신청이 차단돼요.
        바텐더의 곡 추가는 언제나 가능해요. 곡 수 제한은 재생중인 곡까지 합산해
        세고, 0을 넣으면 무제한이에요.
      </div>
    </div>
  );
}
