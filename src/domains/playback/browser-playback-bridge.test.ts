import { expect, test } from "bun:test";
import type {
  PlaybackCommand,
  PlaybackObservation,
} from "../../music/contracts";
import { BrowserPlaybackBridge } from "./browser-playback-bridge";
import type { PlaybackOwner } from "./protocol";

const owner: PlaybackOwner = {
  ownerEpoch: 1,
  executorSessionId: "browser-1",
  heartbeatAt: 1,
  released: false,
  stopConfirmed: false,
  connection: {
    target: { providerId: "fixture", modeId: "browser", targetId: "speaker" },
    location: "browser",
    connectionGeneration: "connection-1",
    capabilities: {
      canPlayExactTrack: true,
      canPause: true,
      canResume: true,
      canStop: true,
      canRestart: true,
      canObserveEnd: true,
      canSeek: false,
    },
  },
};
const command: PlaybackCommand = {
  type: "play",
  trackRef: { providerId: "fixture", trackId: "opaque" },
  initialState: "playing",
  context: {
    commandId: "command-1",
    attemptId: "attempt-1",
    executorSessionId: owner.executorSessionId,
    target: owner.connection.target,
    connectionGeneration: owner.connection.connectionGeneration,
  },
};
const observation: PlaybackObservation = {
  state: "playing",
  trackRef: command.trackRef,
  target: owner.connection.target,
  connectionGeneration: owner.connection.connectionGeneration,
  correlation: command.context,
  binding: {
    providerId: "fixture",
    modeId: "browser",
    version: 1,
    payload: { id: "native" },
  },
  sequence: 1,
  positionSec: 0,
  durationSec: null,
};

test("브라우저 명령은 전달과 접수·실제 관측을 구분해요", async () => {
  const bridge = new BrowserPlaybackBridge();
  bridge.bindOwner(owner);
  const abort = new AbortController();
  const stream = bridge.observe(abort.signal);
  expect((await stream.next()).value?.state).toBe("unavailable");
  const announced = Promise.withResolvers<void>();
  const off = bridge.subscribe(() => announced.resolve());
  try {
    const pending = bridge.execute(command, abort.signal);
    await announced.promise;
    expect(bridge.messages()).toEqual([{ type: "command", command }]);
    expect(
      bridge.acceptReceipt(
        { ...owner, ownerEpoch: 0 },
        {
          status: "accepted",
          context: command.context,
        },
      ),
    ).toBe(false);
    expect(
      bridge.acceptReceipt(owner, {
        status: "accepted",
        context: command.context,
      }),
    ).toBe(true);
    expect((await pending).status).toBe("accepted");
    expect(bridge.messages()).toEqual([]);
    const observed = stream.next();
    expect(bridge.acceptObservation(owner, observation)).toBe(true);
    expect((await observed).value).toEqual(observation);
    expect(bridge.acceptObservation(owner, observation)).toBe(false);
  } finally {
    off();
    abort.abort();
    await bridge.dispose();
  }
});

test("owner 교체는 미확인 명령을 불명으로 끝내고 예전 실행기의 응답을 거절해요", async () => {
  const bridge = new BrowserPlaybackBridge();
  bridge.bindOwner(owner);
  const pending = bridge.execute(command, new AbortController().signal);
  bridge.bindOwner({ ...owner, ownerEpoch: 2, executorSessionId: "browser-2" });
  expect((await pending).status).toBe("unknown");
  expect(
    bridge.acceptReceipt(owner, {
      status: "accepted",
      context: command.context,
    }),
  ).toBe(false);
  expect(bridge.acceptObservation(owner, observation)).toBe(false);
  expect(bridge.messages()).toEqual([]);
  await bridge.dispose();
});

test("재확인은 공급자 응답을 기다리고 다른 owner의 응답을 적용하지 않아요", async () => {
  const bridge = new BrowserPlaybackBridge();
  bridge.bindOwner(owner);
  if (!observation.binding) throw new Error("binding이 필요해요");
  const pending = bridge.reconcile(
    observation.binding,
    new AbortController().signal,
  );
  const message = bridge.messages()[0];
  if (message?.type !== "reconcile") throw new Error("재확인 요청이 필요해요");
  const result = {
    ok: true as const,
    value: { status: "match" as const, observation },
  };
  expect(
    bridge.completeReconcile(
      { ...owner, ownerEpoch: 0 },
      message.requestId,
      result,
    ),
  ).toBe(false);
  expect(bridge.completeReconcile(owner, message.requestId, result)).toBe(true);
  expect(await pending).toEqual(result);
  await bridge.dispose();
});

test("연결 없는 명령은 거절하고 구독 중단은 대기 중 next도 끝내요", async () => {
  const bridge = new BrowserPlaybackBridge();
  expect(
    (await bridge.execute(command, new AbortController().signal)).status,
  ).toBe("rejected");
  const abort = new AbortController();
  const stream = bridge.observe(abort.signal);
  await stream.next();
  const next = stream.next();
  abort.abort();
  expect(await next).toEqual({ done: true, value: undefined });
  await bridge.dispose();
  await bridge.dispose();
  expect(
    (await bridge.execute(command, new AbortController().signal)).status,
  ).toBe("rejected");
});
