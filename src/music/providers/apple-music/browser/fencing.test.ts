import { afterEach, expect, test } from "bun:test";
import type { BrowserMusicProvider } from "../../../contracts/index";
import { fixture, ref, signal, value } from "./test-support";

const providers: BrowserMusicProvider[] = [];
afterEach(async () => {
  for (const provider of providers.splice(0)) await provider.dispose();
});
async function setup() {
  const f = await fixture();
  providers.push(f.provider);
  await f.play();
  return f;
}

test("명령 fence: 다른 실행기의 play와 중복 command는 재생을 반복하지 않아요", async () => {
  const f = await setup();
  const count = f.sdk.calls.length;

  const foreign = await f.playback.execute(
    {
      type: "play",
      trackRef: ref,
      initialState: "playing",
      context: {
        ...f.context,
        commandId: "foreign",
        executorSessionId: "other",
      },
    },
    signal,
  );
  const duplicate = await f.play();

  expect(foreign.status).toBe("rejected");
  expect(duplicate.status).toBe("rejected");
  expect(f.sdk.calls.length).toBe(count);
});

test("정지: SDK Promise 성공만으로 침묵을 확인하지 않아요", async () => {
  const f = await setup();
  f.sdk.automatic = false;
  const stream = f.playback.observe(signal);
  await stream.next();

  const accepted = await f.playback.execute(
    {
      type: "stop",
      context: { ...f.context, commandId: "stop" },
    },
    signal,
  );
  const pending = stream.next();
  f.sdk.state(4);

  expect(accepted.status).toBe("accepted");
  expect((await pending).value?.state).toBe("stopped");
});

test("terminal fence: 정지 후 SDK가 같은 item을 직접 재생해도 이전 occurrence를 재사용하지 않아요", async () => {
  const f = await setup();
  await f.playback.execute(
    {
      type: "stop",
      context: { ...f.context, commandId: "stop" },
    },
    signal,
  );

  await f.sdk.play();

  expect((await f.playback.observe(signal).next()).value?.state).toBe(
    "unknown",
  );
});

test("reconcile: 정확한 binding만 match이고 다른 버전이나 발생은 unknown이에요", async () => {
  const f = await setup();
  const observation = (await f.playback.observe(signal).next()).value;
  if (!observation?.binding) throw new Error("binding이 필요해요.");

  const matched = value(
    await f.playback.reconcile(observation.binding, signal),
  );
  const wrong = value(
    await f.playback.reconcile({ ...observation.binding, version: 8 }, signal),
  );

  expect(matched.status).toBe("match");
  expect(wrong.status).toBe("unknown");
});

test("SDK 오류: 원시 오류와 자격증명 대신 unknown-outcome만 내보내요", async () => {
  const f = await setup();
  f.sdk.pause = async () => {
    throw new Error("SECRET fixture");
  };

  const outcome = await f.playback.execute(
    {
      type: "pause",
      context: { ...f.context, commandId: "pause" },
    },
    signal,
  );

  expect(outcome).toEqual({
    status: "unknown",
    context: { ...f.context, commandId: "pause" },
    error: { code: "unknown-outcome" },
  });
  expect(JSON.stringify(outcome)).not.toContain("SECRET");
});

test("정리: 해제된 리스너를 뒤늦게 호출해도 새 연결에 관측을 보내지 않아요", async () => {
  const first = await setup();
  const late = [...(first.sdk.listeners.get("playbackStateDidChange") ?? [])];
  const item = first.sdk.nowPlayingItem;
  await first.provider.dispose();
  const next = await setup();
  const stream = next.playback.observe(signal);
  await stream.next();
  const waiting = stream.next();

  for (const callback of late) callback({ state: 5, nowPlayingItem: item });
  next.sdk.state(3);

  expect((await waiting).value?.state).toBe("paused");
});
