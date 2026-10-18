import { expect, test } from "bun:test";
import {
  parseBrowserStoppedFence,
  parseConnection,
  parseObservation,
  parseOutcome,
  parseReconciliation,
} from "./dto";

test("브라우저 정지 확인은 현재 소유권과 명시적인 nullable 시도·곡 쌍을 요구해요", () => {
  const idle = {
    ownerEpoch: 1,
    executorSessionId: "browser",
    attemptId: null,
    songId: null,
  };
  expect(parseBrowserStoppedFence(idle)).toEqual(idle);
  expect(
    parseBrowserStoppedFence({ ...idle, attemptId: "a", songId: "s" }),
  ).toEqual({ ...idle, attemptId: "a", songId: "s" });
  for (const override of [
    { ownerEpoch: 0 },
    { ownerEpoch: -1 },
    { ownerEpoch: 1.5 },
    { ownerEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { ownerEpoch: "1" },
    { executorSessionId: "" },
    { attemptId: undefined },
    { songId: undefined },
    { attemptId: "" },
    { songId: 1 },
    { songId: "s" },
    { attemptId: "a" },
  ]) {
    expect(() => parseBrowserStoppedFence({ ...idle, ...override })).toThrow();
  }
});

const target = {
  providerId: "fixture",
  modeId: "browser",
  targetId: "speaker",
};
const context = {
  commandId: "c",
  attemptId: "a",
  executorSessionId: "e",
  target,
  connectionGeneration: "g",
};
const observation = {
  state: "playing",
  trackRef: { providerId: "fixture", trackId: "Case/01" },
  target,
  connectionGeneration: "g",
  correlation: context,
  binding: {
    providerId: "fixture",
    modeId: "browser",
    version: 1,
    payload: { native: "N" },
  },
  sequence: 1,
  positionSec: 0,
  durationSec: null,
};

test("재생 관측 입력은 opaque 식별자와 nullable 길이를 보존하고 추가 필드는 버려요", () => {
  const parsed = parseObservation({ ...observation, secret: "not-public" });
  expect(parsed.trackRef).toEqual(observation.trackRef);
  expect(parsed.durationSec).toBeNull();
  expect("secret" in parsed).toBe(false);
  expect(parsed.correlation).toEqual({
    commandId: "c",
    attemptId: "a",
    executorSessionId: "e",
  });
});

test("재생 관측은 잘못된 순서·위치·종료 사유·binding을 거절해요", () => {
  for (const override of [
    { sequence: -1 },
    { sequence: 1.5 },
    { sequence: Number.NaN },
    { positionSec: Infinity },
    { durationSec: -1 },
    { state: "ended" },
    { state: "playing", endReason: "natural-end" },
    { correlation: { commandId: "c" } },
    {
      binding: { providerId: "f", modeId: "b", version: 1, payload: undefined },
    },
  ]) {
    expect(() => parseObservation({ ...observation, ...override })).toThrow();
  }
  expect(
    parseObservation({
      ...observation,
      state: "ended",
      endReason: "natural-end",
    }).state,
  ).toBe("ended");
});

test("명령 결과는 접수·거절·적용 불명을 서로 바꾸지 않아요", () => {
  expect(parseOutcome({ status: "accepted", context }).status).toBe("accepted");
  expect(
    parseOutcome({
      status: "unknown",
      context,
      error: { code: "unknown-outcome" },
    }).status,
  ).toBe("unknown");
  expect(() =>
    parseOutcome({
      status: "rejected",
      context,
      error: { code: "unknown-outcome" },
    }),
  ).toThrow();
  expect(() =>
    parseOutcome({
      status: "unknown",
      context,
      error: { code: "disconnected" },
    }),
  ).toThrow();
  expect(() =>
    parseOutcome({ status: "accepted", context: { ...context, attemptId: 1 } }),
  ).toThrow();
});

test("브라우저 연결은 실행 위치와 기능의 실제 boolean을 요구해요", () => {
  const value = {
    target,
    connectionGeneration: "g",
    location: "browser",
    capabilities: {
      canPlayExactTrack: true,
      canPause: true,
      canResume: true,
      canStop: true,
      canRestart: true,
      canObserveEnd: true,
      canSeek: false,
    },
  };
  expect(parseConnection(value).location).toBe("browser");
  expect(() => parseConnection({ ...value, location: "server" })).toThrow();
  expect(() =>
    parseConnection({
      ...value,
      capabilities: { ...value.capabilities, canStop: "true" },
    }),
  ).toThrow();
});

test("재확인 match도 검증된 관측을 포함해야 해요", () => {
  expect(
    parseReconciliation({ ok: true, value: { status: "unknown" } }),
  ).toEqual({
    ok: true,
    value: { status: "unknown" },
  });
  expect(
    parseReconciliation({ ok: true, value: { status: "match", observation } })
      .ok,
  ).toBe(true);
  expect(() =>
    parseReconciliation({ ok: true, value: { status: "match" } }),
  ).toThrow();
});
