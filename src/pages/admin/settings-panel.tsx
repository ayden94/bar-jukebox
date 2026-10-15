import { useRef, useState } from "react";
import { admin } from "./styles";
import { UnsavedChanges } from "./unsaved-changes";

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
  onSave: (patch: SettingsPatch) => Promise<void> | void;
};

function useConfirmedDraft(current: string, saving: boolean) {
  const [draft, setDraft] = useState<string | null>(null);
  // 서버가 확인한 초안만 해제하고, 저장 중 바뀐 입력은 그대로 유지해요.
  if (!saving && draft === current) setDraft(null);
  return [draft ?? current, setDraft] as const;
}

export function SettingsPanel({
  requestsPaused,
  notice,
  maxPerDevice,
  maxPerTable,
  onSave,
}: SettingsPanelProps) {
  const [saving, setSaving] = useState(false);
  const [noticeInput, setNoticeDraft] = useConfirmedDraft(notice ?? "", saving);
  const [deviceLimit, setDeviceDraft] = useConfirmedDraft(
    String(maxPerDevice),
    saving,
  );
  const [tableLimit, setTableDraft] = useConfirmedDraft(
    String(maxPerTable),
    saving,
  );
  const pendingSave = useRef(false);
  const dirty =
    noticeInput !== (notice ?? "") ||
    deviceLimit !== String(maxPerDevice) ||
    tableLimit !== String(maxPerTable);

  const save = async (patch: SettingsPatch) => {
    if (pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    try {
      await onSave(patch);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "저장하지 못했어요",
      );
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  };

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
    setDeviceDraft(String(d));
    setTableDraft(String(t));
    void save({ maxPerDevice: d, maxPerTable: t });
  };

  return (
    <section className={admin.panel} aria-labelledby="settings-heading">
      <div className={admin.panelHead}>
        <h2 id="settings-heading">운영 설정</h2>
      </div>
      <UnsavedChanges dirty={dirty} pending={saving} />
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
          disabled={saving}
          onClick={() => void save({ requestsPaused: !requestsPaused })}
        >
          <span
            className={`block h-[22px] w-[38px] rounded-[99px] p-[3px] ${
              requestsPaused
                ? "bg-[var(--admin-muted)]"
                : "bg-[var(--admin-accent)]"
            } [&>span]:block [&>span]:size-4 [&>span]:rounded-full [&>span]:bg-[var(--admin-panel)] ${
              requestsPaused
                ? ""
                : "[&>span]:translate-x-4 [&>span]:bg-[var(--admin-accent-text)]"
            }`}
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
          setNoticeDraft(trimmed);
          void save({ notice: trimmed });
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
            setNoticeDraft(e.currentTarget.value);
          }}
        />
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className={`${admin.note} !mt-0 mr-auto !mb-0 text-xs`}>
            비워두면 공지를 숨겨요.
          </span>
          <button
            className={`${admin.button} ${admin.ghost} admin-button`}
            disabled={saving}
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
              onChange={(e) => setDeviceDraft(e.currentTarget.value)}
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
              onChange={(e) => setTableDraft(e.currentTarget.value)}
            />
          </div>
        </div>
        <p className={admin.note}>재생 중인 곡을 포함해요. 0은 무제한이에요.</p>
        <div className="mt-3 flex items-center justify-end gap-3">
          <button
            className={`${admin.button} ${admin.ghost} admin-button`}
            disabled={saving}
            type="submit"
          >
            제한 저장
          </button>
        </div>
      </form>
    </section>
  );
}
