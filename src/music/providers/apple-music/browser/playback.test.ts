import { afterEach, expect, test } from "bun:test";
import type { BrowserMusicProvider } from "../../../contracts/index";
import { fixture, ref, signal, value } from "./test-support";

const providers: BrowserMusicProvider[] = [];
afterEach(async () => {
  for (const provider of providers.splice(0)) await provider.dispose();
});
async function setup() {
  const result = await fixture();
  providers.push(result.provider);
  return result;
}

test("재생: SDK 접수만으로 playing이나 정지를 만들어내지 않아요", async () => {
  const f = await setup();
  f.sdk.automatic = false;
  const stream = f.playback.observe(signal);
  await stream.next();

  expect((await f.play()).status).toBe("accepted");
  const pending = stream.next();
  f.sdk.state(2);
  const observed = (await pending).value;
  expect(observed?.state).toBe("playing");
  expect(observed?.trackRef).toEqual(ref);
  expect(observed?.correlation?.commandId).toBe("play-1");
});

test("제어: pause와 resume은 occurrence를 보존하고 seek를 SDK에 전달해요", async () => {
  const f = await setup();
  await f.play();
  const initial = (await f.playback.observe(signal).next()).value;
  const context = { ...f.context, commandId: "pause-1" };

  expect(
    (await f.playback.execute({ type: "pause", context }, signal)).status,
  ).toBe("accepted");
  expect((await f.playback.observe(signal).next()).value?.state).toBe("paused");
  await f.playback.execute(
    { type: "resume", context: { ...context, commandId: "resume-1" } },
    signal,
  );
  await f.playback.execute(
    {
      type: "seek",
      positionSec: 12,
      context: { ...context, commandId: "seek-1" },
    },
    signal,
  );
  const resumed = (await f.playback.observe(signal).next()).value;
  expect(resumed?.binding).toEqual(initial?.binding);
  expect(resumed?.positionSec).toBe(12);
  expect(f.sdk.calls).toContain("seek:12");
});

test("재시작: 같은 곡도 새 occurrence이며 이전 이벤트와 binding을 거절해요", async () => {
  const f = await setup();
  await f.play();
  const previousItem = f.sdk.nowPlayingItem;
  const previous = (await f.playback.observe(signal).next()).value;
  if (!previous?.binding) throw new Error("binding이 필요해요.");
  const context = {
    ...f.context,
    attemptId: "attempt-2",
    commandId: "restart-1",
  };

  await f.playback.execute(
    { type: "restart", initialState: "paused", context },
    signal,
  );
  f.sdk.emit("playbackStateDidChange", {
    state: 5,
    nowPlayingItem: previousItem,
  });
  const current = (await f.playback.observe(signal).next()).value;
  expect(current?.state).toBe("paused");
  expect(current?.positionSec).toBe(0);
  expect(current?.binding).not.toEqual(previous.binding);
  expect(
    value(await f.playback.reconcile(previous.binding, signal)).status,
  ).toBe("unknown");
  expect(f.sdk.volume).toBe(1);
});

test("종료: duration과 오래된 상태는 완료가 아니고 현재 item의 ended만 확정해요", async () => {
  const f = await setup();
  await f.play();
  f.sdk.currentPlaybackTime = f.sdk.currentPlaybackDuration;
  f.sdk.emit("playbackTimeDidChange", {});
  f.sdk.emit("playbackStateDidChange", {
    state: 5,
    nowPlayingItem: f.sdk.nowPlayingItem,
  });
  expect((await f.playback.observe(signal).next()).value?.state).toBe(
    "playing",
  );

  f.sdk.state(5);

  expect((await f.playback.observe(signal).next()).value).toMatchObject({
    state: "ended",
    endReason: "natural-end",
  });
});

test("관측: manual 교체 후 같은 ID로 돌아와도 소유권을 추정하지 않아요", async () => {
  const f = await setup();
  await f.play();
  const before = (await f.playback.observe(signal).next()).value;
  if (!before?.binding) throw new Error("binding이 필요해요.");

  f.sdk.nowPlayingItem = { id: "123" };
  f.sdk.emit("nowPlayingItemDidChange", { item: f.sdk.nowPlayingItem });

  expect((await f.playback.observe(signal).next()).value?.state).toBe(
    "unknown",
  );
  expect(value(await f.playback.reconcile(before.binding, signal)).status).toBe(
    "unknown",
  );
});

test("fence: 다른 연결과 실행기의 명령은 SDK에 전달하지 않아요", async () => {
  const f = await setup();
  await f.play();
  const count = f.sdk.calls.length;

  const result = await f.playback.execute(
    { type: "stop", context: { ...f.context, executorSessionId: "other" } },
    signal,
  );

  expect(result.status).toBe("rejected");
  expect(f.sdk.calls.length).toBe(count);
});

test("취소: 발행 후 setQueue 취소는 unknown이며 늦은 완료로 play하지 않아요", async () => {
  const f = await setup();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.sdk.beforeQueue = () => {
    entered.resolve();
    return release.promise;
  };
  const controller = new AbortController();
  const work = f.playback.execute(
    {
      type: "play",
      trackRef: ref,
      initialState: "playing",
      context: f.context,
    },
    controller.signal,
  );
  await entered.promise;

  controller.abort();
  expect((await work).status).toBe("unknown");
  const closing = f.provider.dispose();
  release.resolve();
  await closing;

  expect(f.sdk.calls).not.toContain("play");
  expect(f.sdk.listenerCount).toBe(0);
});

test("정리: abort와 return은 대기 관측을 닫고 dispose는 정지 관측을 위조하지 않아요", async () => {
  const f = await setup();
  const controller = new AbortController();
  const stream = f.playback.observe(controller.signal);
  await stream.next();
  const pending = stream.next();

  controller.abort();
  expect((await pending).done).toBe(true);
  await f.provider.dispose();

  expect(f.sdk.listenerCount).toBe(0);
  expect((await f.playback.observe(signal).next()).done).toBe(true);
  expect((await f.play()).status).toBe("rejected");
});

test("실패: DRM preview 전환과 SDK 예외는 성공 완료가 아니에요", async () => {
  const f = await setup();
  await f.play();

  f.sdk.emit("drmUnsupported", {});

  expect((await f.playback.observe(signal).next()).value?.state).toBe(
    "unknown",
  );
  expect(f.sdk.calls).toContain("stop");
});
