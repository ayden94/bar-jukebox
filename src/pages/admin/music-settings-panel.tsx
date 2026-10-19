import type { MusicConfigView, MusicSnapshot } from "./music-types";
import { admin } from "./styles";

const sourceLabels = {
  environment: "환경 변수",
  saved: "저장된 설정",
  default: "기본값",
  unset: "미설정",
} as const;

const selectClass =
  "min-h-11 w-full min-w-0 rounded-[10px] border border-[var(--admin-panel-border)] bg-[var(--admin-input-bg)] px-3 py-2.5 text-sm text-[var(--admin-ink)] disabled:opacity-60";

export function configLabel(
  config: MusicConfigView | null,
  snapshot: MusicSnapshot,
) {
  if (!config || (!config.providerId && !config.modeId)) return "미설정";
  const registration = snapshot.providers.find(
    (provider) => provider.descriptor.providerId === config.providerId,
  );
  const mode = registration?.modes.find(
    (entry) => entry.modeId === config.modeId,
  );
  return `${registration?.descriptor.displayName ?? config.providerId} · ${mode?.displayName ?? config.modeId}`;
}

type MusicSettingsPanelProps = {
  snapshot: MusicSnapshot;
  selected: MusicConfigView;
  pending: boolean;
  dirty: boolean;
  onChange: (config: MusicConfigView) => void;
  onSave: () => Promise<void>;
};

export function MusicSettingsPanel({
  snapshot,
  selected,
  pending,
  dirty,
  onChange,
  onSave,
}: MusicSettingsPanelProps) {
  const registration = snapshot.providers.find(
    (provider) => provider.descriptor.providerId === selected.providerId,
  );
  const modes = registration?.modes ?? [];
  const selectedMode = modes.find((mode) => mode.modeId === selected.modeId);
  return (
    <section
      className="min-w-0 pt-5"
      aria-labelledby="music-config-heading"
      data-restart-required={snapshot.restartRequired}
    >
      <div className={admin.panelHead}>
        <h2 id="music-config-heading">음악 서비스 설정</h2>
      </div>
      <dl className="m-0 grid gap-2">
        <dt className="font-semibold">현재 실행 설정</dt>
        <dd className="m-0 break-words">
          {configLabel(snapshot.active, snapshot)}
        </dd>
        <dd className={`m-0 ${admin.note}`}>
          서비스: {sourceLabels[snapshot.activeSources.providerId]} · 재생 방식:{" "}
          {sourceLabels[snapshot.activeSources.modeId]}
        </dd>
        <dt className="mt-3 font-semibold">다음 시작 설정</dt>
        <dd className="m-0 break-words">
          {configLabel(snapshot.nextBoot.config, snapshot)}
        </dd>
      </dl>
      <p className={admin.note}>
        실행 중인 음악 서비스는 바뀌지 않아요. 저장한 설정은 서버를 다시 시작할
        때 적용해요.
      </p>
      {snapshot.restartRequired && (
        <p className="mt-4 rounded-[10px] bg-[var(--admin-input-bg)] p-3">
          다음 시작 설정이 달라요. 서버를 다시 시작해야 적용돼요.
        </p>
      )}
      {snapshot.nextBoot.issue && (
        <p className={admin.note}>{snapshot.nextBoot.issue}</p>
      )}
      <form
        className="mt-5 grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && dirty && selectedMode?.available) void onSave();
        }}
      >
        <div>
          <label className={admin.fieldLabel} htmlFor="music-provider">
            음악 서비스
          </label>
          <select
            aria-describedby="music-provider-help"
            className={selectClass}
            disabled={pending || snapshot.locks.providerId}
            id="music-provider"
            name="providerId"
            onChange={(event) => {
              const providerId = event.currentTarget.value;
              const next = snapshot.providers.find(
                (entry) => entry.descriptor.providerId === providerId,
              );
              onChange({
                providerId,
                modeId: snapshot.locks.modeId
                  ? selected.modeId
                  : (next?.modes.find((mode) => mode.available)?.modeId ?? ""),
              });
            }}
            value={selected.providerId}
          >
            {!registration && (
              <option value={selected.providerId}>
                {selected.providerId || "서비스를 선택해주세요"}
              </option>
            )}
            {snapshot.providers.map((provider) => (
              <option
                disabled={!provider.modes.some((mode) => mode.available)}
                key={provider.descriptor.providerId}
                value={provider.descriptor.providerId}
              >
                {provider.descriptor.displayName}
                {!provider.modes.some((mode) => mode.available)
                  ? ` · ${provider.modes[0]?.unavailableReason ?? "사용 불가"}`
                  : ""}
              </option>
            ))}
          </select>
          <p className={admin.note} id="music-provider-help">
            {snapshot.locks.providerId
              ? "MUSIC_PROVIDER 환경 변수로 고정돼 있어요. 서버 환경 변수를 수정해주세요."
              : "서버에 등록된 음악 서비스만 선택할 수 있어요."}
          </p>
        </div>
        <div>
          <label className={admin.fieldLabel} htmlFor="music-mode">
            재생 방식
          </label>
          <select
            aria-describedby="music-mode-help"
            className={selectClass}
            disabled={pending || snapshot.locks.modeId || !registration}
            id="music-mode"
            name="modeId"
            onChange={(event) =>
              onChange({ ...selected, modeId: event.currentTarget.value })
            }
            value={selected.modeId}
          >
            {!selectedMode && (
              <option value={selected.modeId}>
                {selected.modeId || "재생 방식을 선택해주세요"}
              </option>
            )}
            {modes.map((mode) => (
              <option
                disabled={!mode.available}
                key={mode.modeId}
                value={mode.modeId}
              >
                {mode.displayName}
                {!mode.available
                  ? ` · ${mode.unavailableReason ?? "사용 불가"}`
                  : ""}
              </option>
            ))}
          </select>
          <p className={admin.note} id="music-mode-help">
            {snapshot.locks.modeId
              ? "MUSIC_PLAYBACK_MODE 환경 변수로 고정돼 있어요. 서버 환경 변수를 수정해주세요."
              : "이 서버 환경에서 지원하는 재생 방식만 저장할 수 있어요."}
          </p>
          {snapshot.providers.flatMap((provider) =>
            provider.modes
              .filter((mode) => !mode.available)
              .map((mode) => (
                <p
                  className={admin.note}
                  key={`${provider.descriptor.providerId}/${mode.modeId}`}
                >
                  {provider.descriptor.displayName} · {mode.displayName}:{" "}
                  {mode.unavailableReason ?? "이 환경에서 사용할 수 없어요."}
                </p>
              )),
          )}
        </div>
        <button
          className={admin.button}
          disabled={pending || !dirty || !selectedMode?.available}
          type="submit"
        >
          {pending ? "처리 중…" : "다음 시작 설정 저장"}
        </button>
      </form>
    </section>
  );
}
