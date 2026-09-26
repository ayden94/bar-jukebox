import { useState } from "react";

type SettingsPanelProps = {
  requestsPaused: boolean;
  onSave: (patch: { requestsPaused?: boolean; notice?: string }) => void;
};

export function SettingsPanel({ requestsPaused, onSave }: SettingsPanelProps) {
  const [noticeInput, setNoticeInput] = useState("");

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
          onChange={(e) => setNoticeInput((e.target as HTMLInputElement).value)}
        />
        <button
          className="btn"
          type="button"
          onClick={() => onSave({ notice: noticeInput.trim() })}
        >
          저장
        </button>
      </div>
      <div className="note">
        신청을 일시중지하면 손님 화면에 안내가 표시되고 신청이 차단돼요.
        바텐더의 곡 추가는 언제나 가능해요.
      </div>
    </div>
  );
}
