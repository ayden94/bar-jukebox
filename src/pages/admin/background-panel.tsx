import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types";
import { admin } from "./styles";

type BackgroundSettings = {
  enabled: boolean;
  playlist: string;
  handoff: "after-track" | "immediate";
};

type BackgroundStatus = {
  available: boolean;
  active: boolean;
  waitingForTrackEnd: boolean;
  now: { title: string; artist: string | null } | null;
  playlist: string | null;
  error: string | null;
};

type BackgroundSnapshot = {
  settings: BackgroundSettings;
  status: BackgroundStatus;
};

type BackgroundPanelProps = {
  snap: Snapshot | null;
  api: (path: string, options?: RequestInit) => Promise<Response>;
};

export function BackgroundPanel({ snap, api }: BackgroundPanelProps) {
  const [data, setData] = useState<BackgroundSnapshot | null>(null);
  const [playlists, setPlaylists] = useState<readonly string[] | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api("/api/admin/background");
      setData((await res.json()) as BackgroundSnapshot);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "배경 음악 상태를 불러오지 못했어요",
      );
    }
  }, [api]);

  // 공개 상태가 바뀔 때마다(곡 전환, 배경곡 변경) 관리자 전용 상태도 다시 읽어요.
  useEffect(() => {
    void snap;
    void load();
  }, [snap, load]);

  const run = async (work: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMessage("");
    try {
      await work();
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "요청을 완료하지 못했어요",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const save = (patch: Partial<BackgroundSettings>) =>
    run(async () => {
      await api("/api/admin/background/settings", {
        method: "POST",
        body: JSON.stringify(patch),
      });
    });

  const loadPlaylists = () =>
    run(async () => {
      const res = await api("/api/admin/background/playlists");
      const body = (await res.json()) as { playlists: string[] };
      setPlaylists(body.playlists);
    });

  const control = (action: "start" | "stop") =>
    run(async () => {
      await api(`/api/admin/background/${action}`, { method: "POST" });
    });

  if (!data) {
    return (
      <section className={admin.panel} aria-labelledby="background-heading">
        <div className={admin.panelHead}>
          <h2 id="background-heading">배경 음악</h2>
        </div>
        <p className={admin.note} role="status">
          {message || "배경 음악 상태를 확인하고 있어요."}
        </p>
      </section>
    );
  }

  const { settings, status } = data;
  const idle = !snap?.nowPlaying && (snap?.queue.length ?? 0) === 0;
  const options = playlists ?? (settings.playlist ? [settings.playlist] : []);
  const statusText = !status.available
    ? "이 재생 방식은 배경 음악을 지원하지 않아요"
    : status.waitingForTrackEnd
      ? "지금 배경곡이 끝나면 신청곡을 시작해요"
      : status.active && status.now
        ? `배경 음악 재생 중 · ${status.now.title}${status.now.artist ? ` — ${status.now.artist}` : ""}`
        : settings.enabled
          ? "신청곡이 없으면 배경 음악을 틀어요"
          : "배경 음악이 꺼져 있어요";

  return (
    <section className={admin.panel} aria-labelledby="background-heading">
      <div className={admin.panelHead}>
        <h2 id="background-heading">배경 음악</h2>
      </div>
      <p className={`${admin.note} !mt-0`} role="status">
        {statusText}
      </p>
      {status.error ? (
        <p className={`${admin.note} text-[var(--admin-red)]`} role="alert">
          {status.error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3 [&_strong]:text-[0.85rem]">
        <div>
          <strong>한적할 때 자동으로 틀기</strong>
          <p className={`${admin.note} !mt-1 text-xs`}>
            신청이 없으면 고른 재생 목록을 섞어서 틀어요.
          </p>
        </div>
        <button
          className="flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-40"
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label="한적할 때 배경 음악 자동으로 틀기"
          disabled={pending || !status.available}
          onClick={() => void save({ enabled: !settings.enabled })}
        >
          <span
            className={`block h-[22px] w-[38px] rounded-[99px] p-[3px] ${
              settings.enabled
                ? "bg-[var(--admin-accent)]"
                : "bg-[var(--admin-muted)]"
            } [&>span]:block [&>span]:size-4 [&>span]:rounded-full [&>span]:bg-[var(--admin-panel)] ${
              settings.enabled
                ? "[&>span]:translate-x-4 [&>span]:bg-[var(--admin-accent-text)]"
                : ""
            }`}
            aria-hidden="true"
          >
            <span />
          </span>
        </button>
      </div>
      <div className="mt-[22px] border-t border-[var(--admin-panel-border)] pt-[22px]">
        <label className={admin.fieldLabel} htmlFor="background-playlist">
          재생 목록
        </label>
        <div className={admin.field}>
          <select
            id="background-playlist"
            className="min-h-11 w-full min-w-0 rounded-[10px] border border-[var(--admin-panel-border)] bg-[var(--admin-input-bg)] px-3 text-sm text-[var(--admin-ink)]"
            value={settings.playlist}
            disabled={pending || !status.available}
            onChange={(event) =>
              void save({ playlist: event.currentTarget.value })
            }
          >
            <option value="">재생 목록 선택</option>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            className={`${admin.button} ${admin.ghost} admin-button`}
            type="button"
            disabled={pending || !status.available}
            onClick={() => void loadPlaylists()}
          >
            목록 불러오기
          </button>
        </div>
        <p className={admin.note}>
          Music 앱에서 만든 재생 목록이 보여요. 매장 분위기에 맞는 목록을
          골라주세요.
        </p>
      </div>
      <fieldset className="mt-[22px] min-w-0 border-0 border-t border-[var(--admin-panel-border)] p-0 pt-[22px]">
        <legend className={`${admin.fieldLabel} float-left w-full`}>
          신청이 들어오면
        </legend>
        {(
          [
            [
              "after-track",
              "지금 배경곡이 끝난 뒤 넘기기",
              "곡 중간에 끊기지 않아요.",
            ],
            [
              "immediate",
              "바로 줄이며 넘기기",
              "소리를 서서히 줄이고 신청곡을 시작해요.",
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 text-sm"
          >
            <input
              className="!mt-0.5 !size-5 !min-h-0 shrink-0"
              type="radio"
              name="background-handoff"
              value={value}
              checked={settings.handoff === value}
              disabled={pending || !status.available}
              onChange={() => void save({ handoff: value })}
            />
            <span>
              {label}
              <span className={`${admin.note} !mt-0.5 block text-xs`}>
                {hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-[22px] flex flex-wrap items-center justify-end gap-2 border-t border-[var(--admin-panel-border)] pt-[22px]">
        <span className={`${admin.note} !mt-0 mr-auto !mb-0 text-xs`}>
          {idle
            ? "신청곡이 없을 때만 바꿀 수 있어요."
            : "신청곡이 있어 지금은 바꿀 수 없어요."}
        </span>
        <button
          className={`${admin.button} ${admin.ghost} admin-button`}
          type="button"
          disabled={pending || !status.available || !idle || !status.active}
          onClick={() => void control("stop")}
        >
          배경 멈추기
        </button>
        <button
          className={`${admin.button} admin-button`}
          type="button"
          disabled={pending || !status.available || !idle || !settings.playlist}
          onClick={() => void control("start")}
        >
          지금 배경 틀기
        </button>
      </div>
      {message ? (
        <p className={`${admin.note} text-[var(--admin-red)]`} role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
