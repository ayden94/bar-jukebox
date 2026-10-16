import type { ConnectionTarget } from "../../music/contracts";
import type { MusicConfigView, MusicSnapshot } from "./music-types";
import { admin } from "./styles";

const sourceLabels = {
  environment: "환경 변수",
  saved: "저장된 설정",
  default: "기본값",
  unset: "미설정",
} as const;

const readinessLabels = {
  "setup-required": "설정 필요",
  disabled: "재생 비활성",
  ready: "재생 준비 완료",
  connecting: "연결 중",
  "auth-required": "음악 권한 확인 필요",
  unavailable: "재생 연결 안 됨",
  conflict: "음악 서비스 충돌",
} as const;

const authLabels = {
  disconnected: "연결 안 됨",
  connecting: "연결 중",
  authorized: "음악 권한 확인됨",
  "insufficient-permission": "음악 권한 부족",
  "reauth-required": "다시 연결 필요",
} as const;

const selectClass =
  "min-h-11 w-full min-w-0 rounded-[10px] border border-[var(--admin-panel-border)] bg-[var(--admin-input-bg)] px-3 py-2.5 text-sm text-[var(--admin-ink)] disabled:opacity-60";

function configLabel(config: MusicConfigView | null, snapshot: MusicSnapshot) {
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
    <section className={admin.panel} aria-labelledby="music-config-heading">
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
                key={provider.descriptor.providerId}
                value={provider.descriptor.providerId}
              >
                {provider.descriptor.displayName}
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
                {!mode.available ? " (사용 불가)" : ""}
              </option>
            ))}
          </select>
          <p className={admin.note} id="music-mode-help">
            {snapshot.locks.modeId
              ? "MUSIC_PLAYBACK_MODE 환경 변수로 고정돼 있어요. 서버 환경 변수를 수정해주세요."
              : "이 서버 환경에서 지원하는 재생 방식만 저장할 수 있어요."}
          </p>
          {modes
            .filter((mode) => !mode.available)
            .map((mode) => (
              <p className={admin.note} key={mode.modeId}>
                {mode.displayName}:{" "}
                {mode.unavailableReason ?? "이 환경에서 사용할 수 없어요."}
              </p>
            ))}
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

type MusicConnectionPanelProps = {
  snapshot: MusicSnapshot;
  targets: readonly ConnectionTarget[];
  pending: boolean;
  onAction: (path: string, body?: unknown) => Promise<boolean>;
  onLoadTargets: () => Promise<void>;
};

export function MusicConnectionPanel({
  snapshot,
  targets,
  pending,
  onAction,
  onLoadTargets,
}: MusicConnectionPanelProps) {
  const auth = snapshot.auth;
  return (
    <section className={admin.panel} aria-labelledby="music-connection-heading">
      <div className={admin.panelHead}>
        <h2 id="music-connection-heading">연결과 재생 준비</h2>
        <span className={admin.count} data-readiness={snapshot.readiness}>
          {readinessLabels[snapshot.readiness]}
        </span>
      </div>
      {snapshot.reason && <p className={admin.note}>{snapshot.reason}</p>}
      <dl className="mt-5 mb-0 grid gap-2">
        <dt className="font-semibold">앱 관리자 인증</dt>
        <dd className="m-0">관리자 로그인됨</dd>
        <dt className="mt-3 font-semibold">음악 서비스 권한</dt>
        <dd className="m-0" data-auth-status={auth?.status ?? "unavailable"}>
          {auth ? authLabels[auth.status] : "음악 실행기가 준비되지 않았어요."}
        </dd>
        <dd className={`m-0 ${admin.note}`}>
          {auth?.authorization === "user"
            ? "음악 계정의 권한이에요. 관리자 로그인과는 별개예요."
            : auth?.authorization === "service"
              ? "서비스가 관리하는 음악 권한이에요. 관리자 로그인과는 별개예요."
              : "관리자 로그인만으로 음악 계정 권한이 생기지는 않아요."}
        </dd>
      </dl>
      {auth?.action?.kind === "user-gesture" && (
        <p className={admin.note}>{auth.action.label}</p>
      )}
      {auth?.action?.kind === "open-url" &&
        /^https?:\/\//u.test(auth.action.url) && (
          <a
            className={`${admin.button} ${admin.ghost} mt-3`}
            href={auth.action.url}
            rel="noreferrer"
            target="_blank"
          >
            음악 서비스 연결 안내 열기
          </a>
        )}
      <div className="mt-3 flex flex-wrap gap-2">
        {snapshot.actions.connectAuth && (
          <button
            className={admin.button}
            disabled={pending || auth?.status === "connecting"}
            onClick={() => void onAction("/auth/connect")}
            type="button"
          >
            음악 권한 연결
          </button>
        )}
        {snapshot.actions.disconnectAuth && (
          <button
            className={`${admin.button} ${admin.ghost}`}
            disabled={pending || auth?.status === "disconnected"}
            onClick={() => void onAction("/auth/disconnect")}
            type="button"
          >
            음악 권한 연결 해제
          </button>
        )}
      </div>
      <dl className="mt-5 mb-0 grid gap-2">
        <dt className="font-semibold">재생 연결 대상</dt>
        <dd className="m-0 break-words">
          {snapshot.connectedTarget
            ? `${snapshot.connectedTarget.location === "server" ? "서버" : "브라우저"} · ${snapshot.connectedTarget.target.targetId}`
            : "연결된 재생 기기가 없어요."}
        </dd>
        <dt className="mt-3 font-semibold">재생 주체</dt>
        <dd
          className="m-0"
          data-owner-location={snapshot.owner?.location ?? "none"}
        >
          {snapshot.owner
            ? snapshot.owner.location === "server"
              ? "서버 실행기가 재생을 담당해요."
              : "관리자 브라우저 실행기가 재생을 담당해요."
            : "현재 재생 권한을 가진 실행기가 없어요."}
        </dd>
      </dl>
      <p className={admin.note}>
        음악 계정 연결과 재생 주체 선택은 별개예요. 브라우저 재생 실행기는 아직
        제공하지 않아요. 이 페이지에서 플레이어를 만들거나 재생 주체를 자동으로
        바꾸지 않아요.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {snapshot.actions.listTargets && (
          <button
            className={`${admin.button} ${admin.ghost}`}
            disabled={pending}
            onClick={() => void onLoadTargets()}
            type="button"
          >
            연결 가능한 기기 조회
          </button>
        )}
        {snapshot.actions.disconnectTarget && snapshot.connectedTarget && (
          <button
            className={`${admin.button} ${admin.ghost}`}
            disabled={pending}
            onClick={() => void onAction("/targets/disconnect")}
            type="button"
          >
            재생 기기 연결 해제
          </button>
        )}
      </div>
      {targets.length > 0 && (
        <ul className="mt-4 list-none space-y-3 p-0">
          {targets.map((target) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3"
              key={JSON.stringify(target.ref)}
            >
              <span className="min-w-0 break-words">{target.label}</span>
              <button
                className={`${admin.button} ${admin.ghost}`}
                disabled={
                  pending ||
                  !snapshot.actions.connectTarget ||
                  target.location === "browser"
                }
                onClick={() => void onAction("/targets/connect", target.ref)}
                type="button"
              >
                {target.location === "browser"
                  ? "아직 지원하지 않아요"
                  : "기기 연결"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
