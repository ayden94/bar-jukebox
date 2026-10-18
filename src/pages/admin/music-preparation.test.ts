import { expect, test } from "bun:test";
import type { PlaybackSnapshot } from "../../domains/playback/protocol";
import { createContrastingProvider } from "../../music/testing";
import { browserPreparation } from "./music-preparation";
import type { MusicSnapshot } from "./music-types";

const fixture = createContrastingProvider({ location: "browser" });
const snapshot: MusicSnapshot = {
  active: { providerId: "apple-music", modeId: "musickit" },
  activeSources: { providerId: "saved", modeId: "saved" },
  nextBoot: {
    config: { providerId: "apple-music", modeId: "musickit" },
    sources: { providerId: "saved", modeId: "saved" },
    issue: null,
  },
  locks: { providerId: false, modeId: false },
  restartRequired: false,
  providers: [],
  readiness: "auth-required",
  reason: null,
  auth: { status: "reauth-required", authorization: "none", action: null },
  connectedTarget: null,
  owner: null,
  actions: {
    connectAuth: true,
    disconnectAuth: true,
    listTargets: false,
    connectTarget: false,
    disconnectTarget: false,
  },
};
const empty: PlaybackSnapshot = {
  owner: null,
  ownerConnected: false,
  attempt: null,
  commands: [],
};
await fixture.provider.auth.connect(new AbortController().signal);
const connected = await fixture.runtime.connection.connect(
  { ...fixture.provider.identity, targetId: "speaker:anywhere" },
  new AbortController().signal,
);
if (!connected.ok) throw new Error("브라우저 연결 fixture가 필요해요.");
const owned: PlaybackSnapshot = {
  ...empty,
  ownerConnected: true,
  owner: {
    ownerEpoch: 1,
    executorSessionId: "other-document",
    connection: connected.value,
    heartbeatAt: 1,
    released: false,
    stopConfirmed: false,
  },
};
const ready: MusicSnapshot = {
  ...snapshot,
  readiness: "ready",
  owner: {
    executorSessionId: "other-document",
    location: "browser",
    expiresAt: null,
  },
};
await fixture.provider.dispose();

test("준비 상태: 서버의 토큰 설치 사유만 설치 필요로 분류해요", () => {
  const input = {
    snapshot: {
      ...snapshot,
      reason: "MUSICKIT_DEVELOPER_TOKEN 설정 필요",
    },
    playback: empty,
    state: { phase: "disconnected", error: "" } as const,
    fresh: true,
  };

  expect(browserPreparation(input)).toBe("installation-required");
  expect(
    browserPreparation({
      ...input,
      snapshot: { ...snapshot, reason: "auth-required" },
      state: { phase: "unavailable", error: "configuration" },
    }),
  ).toBe("connect");
});

test("준비 상태: 다른 정상 owner를 보는 문서는 재인증 없는 제어 화면이에요", () => {
  const result = browserPreparation({
    snapshot: ready,
    playback: owned,
    state: { phase: "disconnected", error: "" },
    fresh: true,
  });

  expect(result).toBe("controller");
});

test("준비 상태: 조회 실패 뒤 보관된 ready 스냅샷은 현재 준비 완료가 아니에요", () => {
  const result = browserPreparation({
    snapshot: ready,
    playback: owned,
    state: { phase: "connected", error: "" },
    fresh: false,
  });

  expect(result).toBe("unknown");
});

test("준비 상태: 연결 상실 owner는 새 연결보다 정지 복구가 먼저예요", () => {
  const result = browserPreparation({
    snapshot: ready,
    playback: { ...owned, ownerConnected: false },
    state: { phase: "unknown", error: "" },
    fresh: true,
  });

  expect(result).toBe("recovery-required");
});

test("준비 상태: 실행기 없는 등록 모드는 공급자 이름과 무관하게 사용 불가예요", () => {
  const result = browserPreparation({
    snapshot: { ...snapshot, auth: null, readiness: "unavailable" },
    playback: empty,
    state: { phase: "disconnected", error: "" },
    fresh: true,
  });

  expect(result).toBe("unavailable");
});

test("준비 상태: 따로 조회한 owner가 다르면 이전 연결을 준비 완료로 표시하지 않아요", () => {
  const result = browserPreparation({
    snapshot,
    playback: owned,
    state: { phase: "disconnected", error: "" },
    fresh: true,
  });

  expect(result).toBe("unknown");
});
