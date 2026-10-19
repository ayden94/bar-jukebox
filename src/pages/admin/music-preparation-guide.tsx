import { Link } from "@fluojs/react/client";
import type { BrowserHostPhase } from "./browser-music-lifecycle";
import type { browserPreparation } from "./music-preparation";
import { admin } from "./styles";

type Preparation = ReturnType<typeof browserPreparation>;
const labels = {
  unknown: "현재 상태 확인 필요",
  "installation-required": "설치 설정 필요",
  blocked: "재생 준비 중단",
  unavailable: "아직 사용할 수 없어요",
  preparing: "연결 준비 중",
  connected: "재생기 연결됨 · 소리는 확인 필요",
  controller: "매장 재생기 연결됨 · 이 화면은 리모컨",
  "recovery-required": "이전 재생의 정지 확인 필요",
  connect: "재생 브라우저 연결 필요",
} as const;
const phaseLabels = {
  disconnected: "이 브라우저는 아직 연결하지 않았어요.",
  loading: "선택한 재생기를 준비하고 있어요.",
  authorizing: "음악 계정의 재생 권한을 확인하고 있어요.",
  connecting: "이 브라우저의 재생 기기를 연결하고 있어요.",
  claiming: "서버에서 재생 권한을 확인하고 있어요.",
  connected: "이 브라우저가 재생을 담당해요.",
  disconnecting: "실제 정지와 재생 권한 해제를 확인하고 있어요.",
  unknown: "재생 또는 연결 해제 결과를 확인하지 못했어요.",
  unavailable: "브라우저 재생을 아직 시작할 수 없어요.",
} as const;

type MusicPreparationSummaryProps = {
  readonly preparation: Preparation;
  readonly phase: BrowserHostPhase;
  readonly reason: string | null;
  readonly error: string;
};

export function MusicPreparationSummary({
  preparation,
  phase,
  reason,
  error,
}: MusicPreparationSummaryProps) {
  const descriptions = {
    unknown:
      "최신 상태를 확인하지 못했어요. 이전 연결 정보를 준비 완료로 볼 수 없어요. 상태를 다시 확인해주세요.",
    controller:
      "다른 브라우저가 매장 재생을 담당해요. 이 화면에서는 노래를 관리할 수 있어요. 이 기기의 계정 연결이나 재생 권한 이전은 필요 없어요.",
    connected:
      "계정과 재생기 연결을 마쳤어요. 노래 관리에서 곡을 재생하고 매장 스피커에서 소리가 나는지 직접 확인해주세요.",
    preparing: phaseLabels[phase],
    "installation-required":
      "매장 재생에 필요한 서버 설정을 설치 담당자가 확인해야 해요.",
    unavailable: "선택한 재생 방식의 실행기는 아직 사용할 수 없어요.",
    blocked: reason,
    connect: reason,
    "recovery-required": reason,
  };
  const connected = preparation === "connected" || preparation === "controller";
  return (
    <>
      <p
        className={`my-3 text-lg font-bold ${connected ? "text-[var(--admin-ink)]" : "text-[var(--admin-red)]"}`}
        data-browser-phase={phase}
        role="status"
      >
        {labels[preparation]}
      </p>
      <p className={admin.note} role="status">
        {error}
      </p>
      <p className={admin.note}>{descriptions[preparation]}</p>
      {preparation === "installation-required" && (
        <p className={admin.note}>
          계정 로그인으로 해결되지 않는 서버 설치 단계예요. 설치 담당자에게 아래
          설정 안내를 전달해주세요.
        </p>
      )}
      {preparation === "connect" && (
        <p className={admin.note}>
          매장 스피커에 연결된 기기에서 진행해주세요. 관리자 로그인과 음악
          계정의 재생 권한은 별개예요.
        </p>
      )}
    </>
  );
}

type MusicPreparationActionProps = {
  readonly preparation: Preparation;
  readonly pending: boolean;
  readonly onInstallation: () => void;
  readonly onConnect: () => void;
  readonly onRefresh: () => void;
};

export function MusicPreparationAction({
  preparation,
  pending,
  onInstallation,
  onConnect,
  onRefresh,
}: MusicPreparationActionProps) {
  switch (preparation) {
    case "connected":
    case "controller":
      return (
        <Link className={admin.button} href="/admin/songs">
          노래 관리에서 소리 확인
        </Link>
      );
    case "installation-required":
    case "blocked":
    case "unavailable":
      return (
        <button className={admin.button} onClick={onInstallation} type="button">
          설치 설정 안내 보기
        </button>
      );
    case "connect":
      return (
        <button
          id="browser-music-connect"
          className={admin.button}
          disabled={pending}
          onClick={onConnect}
          type="button"
        >
          이 브라우저 연결
        </button>
      );
    case "unknown":
      return (
        <button
          id="browser-music-refresh"
          className={admin.button}
          disabled={pending}
          onClick={onRefresh}
          type="button"
        >
          현재 상태 다시 확인
        </button>
      );
    case "preparing":
    case "recovery-required":
      return null;
    default:
      return preparation satisfies never;
  }
}

type MusicPreparationStepsProps = { readonly preparation: Preparation };

export function MusicPreparationSteps({
  preparation,
}: MusicPreparationStepsProps) {
  const connected = preparation === "connected" || preparation === "controller";
  if (
    !connected &&
    preparation !== "connect" &&
    preparation !== "preparing" &&
    preparation !== "recovery-required"
  )
    return null;
  return (
    <ol className="my-5 grid list-none gap-2 p-0 sm:grid-cols-3">
      <li className="rounded-[10px] bg-[var(--admin-input-bg)] p-3">
        <strong>1. 음악 계정</strong>
        <p className={admin.note}>
          {connected ? "재생 기기에서 확인됨" : "음악 서비스 권한 확인"}
        </p>
      </li>
      <li className="rounded-[10px] bg-[var(--admin-input-bg)] p-3">
        <strong>2. 재생 기기</strong>
        <p className={admin.note}>
          {connected ? "매장 재생 주체 연결됨" : "연결과 재생 권한 필요"}
        </p>
      </li>
      <li className="rounded-[10px] bg-[var(--admin-input-bg)] p-3">
        <strong>3. 스피커 소리</strong>
        <p className={admin.note}>실제 곡으로 직접 확인</p>
      </li>
    </ol>
  );
}
