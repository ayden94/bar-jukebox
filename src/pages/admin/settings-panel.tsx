import { useEffect, useState } from "react";
import { admin } from "./styles";

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
    <section className={admin.panel} aria-labelledby="settings-heading">
      <div className={admin.panelHead}>
        <h2 id="settings-heading">운영 설정</h2>
      </div>
      <div className="flex items-center justify-between gap-3 [&_strong]:text-[0.85rem]">
        <div>
          <strong>
            {requestsPaused
              ? "곡 신청을 잠시 멈췄어요"
              : "곡 신청을 받고 있어요"}
          </strong>
          <p className={`${admin.note} !mt-1 text-xs`}>
            바텐더는 언제든 곡을 추가할 수 있어요.
          </p>
        </div>
        <button
          className="flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0"
          type="button"
          role="switch"
          aria-checked={!requestsPaused}
          aria-label="손님 곡 신청 받기"
          onClick={() => onSave({ requestsPaused: !requestsPaused })}
        >
          <span
            className={`block h-[22px] w-[38px] rounded-[99px] p-[3px] ${requestsPaused ? "bg-[var(--admin-muted)]" : "bg-[var(--admin-accent)]"} [&>span]:block [&>span]:size-4 [&>span]:rounded-full [&>span]:bg-[var(--admin-panel)] ${requestsPaused ? "" : "[&>span]:translate-x-4 [&>span]:bg-[var(--admin-accent-text)]"}`}
            aria-hidden="true"
          >
            <span />
          </span>
        </button>
      </div>
      <form
        className="mt-[22px] border-t border-[var(--admin-panel-border)] pt-[22px]"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = noticeInput.trim();
          setNoticeInput(trimmed);
          onSave({ notice: trimmed });
        }}
      >
        <label className={admin.fieldLabel} htmlFor="notice-input">
          손님에게 보낼 공지
        </label>
        <textarea
          id="notice-input"
          placeholder="예: 오늘은 재즈와 함께해요"
          rows={3}
          maxLength={200}
          value={noticeInput}
          onChange={(e) => {
            setNoticeDirty(true);
            setNoticeInput(e.currentTarget.value);
          }}
        />
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className={`${admin.note} !mt-0 mr-auto !mb-0 text-xs`}>
            비워두면 공지를 숨겨요.
          </span>
          <button
            className={`${admin.button} ${admin.ghost} admin-button`}
            type="submit"
          >
            공지 저장
          </button>
        </div>
      </form>
      <form
        className="mt-[22px] border-t border-[var(--admin-panel-border)] pt-[22px]"
        onSubmit={(event) => {
          event.preventDefault();
          saveLimits();
        }}
      >
        <div className={admin.fieldLabel}>신청 곡 수 제한</div>
        <div className="grid grid-cols-2 gap-3 [&_label]:mb-1.5 [&_label]:block [&_label]:text-xs [&_label]:text-[var(--admin-muted)]">
          <div>
            <label htmlFor="limit-device">기기당 최대</label>
            <input
              id="limit-device"
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              required
              value={deviceLimit}
              onChange={(e) => setDeviceLimit(e.currentTarget.value)}
            />
          </div>
          <div>
            <label htmlFor="limit-table">테이블당 최대</label>
            <input
              id="limit-table"
              type="number"
              min={0}
              max={99}
              inputMode="numeric"
              required
              value={tableLimit}
              onChange={(e) => setTableLimit(e.currentTarget.value)}
            />
          </div>
        </div>
        <p className={admin.note}>재생 중인 곡을 포함해요. 0은 무제한이에요.</p>
        <div className="mt-3 flex items-center justify-end gap-3">
          <button
            className={`${admin.button} ${admin.ghost} admin-button`}
            type="submit"
          >
            제한 저장
          </button>
        </div>
      </form>
    </section>
  );
}
