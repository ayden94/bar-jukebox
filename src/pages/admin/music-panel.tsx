import type { ConnectionTarget } from "../../music/contracts";
import type { MusicSnapshot } from "./music-types";
import { admin } from "./styles";

const readinessLabels = {
  "setup-required": "설정 필요",
  disabled: "재생 비활성",
  ready: "재생기 연결됨",
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
      <p className={admin.note} role="status">
        {snapshot.reason}
      </p>
      {snapshot.readiness === "ready" ? (
        <>
          <p className={admin.note}>
            음악 권한과 재생기 연결을 마쳤어요. 아직 소리 확인 완료는 아니에요.
            노래 관리에서 실제 곡을 재생하고 매장 스피커를 확인해주세요.
          </p>
          <a className={`${admin.button} mt-4`} href="/admin/songs">
            노래 관리에서 소리 확인
          </a>
        </>
      ) : snapshot.actions.connectAuth && auth?.status !== "authorized" ? (
        <button
          className={`${admin.button} mt-4`}
          disabled={pending || auth?.status === "connecting"}
          onClick={() => void onAction("/auth/connect")}
          type="button"
        >
          음악 권한 연결
        </button>
      ) : snapshot.actions.listTargets ? (
        <button
          className={`${admin.button} mt-4`}
          disabled={pending}
          onClick={() => void onLoadTargets()}
          type="button"
        >
          연결 가능한 기기 조회
        </button>
      ) : null}
      <details className="mt-5">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">
          음악 권한과 연결 관리
        </summary>
        <dl className="mt-5 mb-0 grid gap-2">
          <dt className="font-semibold">앱 관리자 인증</dt>
          <dd className="m-0">관리자 로그인됨</dd>
          <dt className="mt-3 font-semibold">음악 서비스 권한</dt>
          <dd className="m-0" data-auth-status={auth?.status ?? "unavailable"}>
            {auth
              ? authLabels[auth.status]
              : "음악 실행기가 준비되지 않았어요."}
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
          관리자 로그인, 음악 계정 권한, 재생 기기는 각각 별개예요. 현재 재생
          방식은 서버를 다시 시작하기 전까지 유지해요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {snapshot.actions.disconnectTarget &&
            (snapshot.connectedTarget || snapshot.owner) && (
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
      </details>
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
