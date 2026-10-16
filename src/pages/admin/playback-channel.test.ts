import { expect, test } from "bun:test";
import { PlaybackChannelError, playbackEvents } from "./playback-channel";

const signal = new AbortController().signal;

test("fetch 중단으로 이미 오류가 된 스트림도 미처리 rejection 없이 정리해요", async () => {
  const abort = new AbortController();
  const entered = Promise.withResolvers<void>();
  const fetcher = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          abort.signal.addEventListener(
            "abort",
            () => controller.error(abort.signal.reason),
            { once: true },
          );
        },
        pull() {
          entered.resolve();
        },
      }),
    );
  const iterator = playbackEvents("t", "browser", abort.signal, fetcher);
  const next = iterator.next();
  await entered.promise;
  abort.abort();
  expect(await next).toEqual({ done: true, value: undefined });
});

function response(bytes: Uint8Array, split = 1) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += split) {
          controller.enqueue(bytes.slice(i, i + split));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("재생 SSE는 헤더 인증과 분할 UTF-8·CRLF·여러 data 행을 보존해요", async () => {
  const payload = new TextEncoder().encode(
    ': heartbeat\r\n\r\nid: 1\r\nevent: snapshot\r\ndata: {"title":\r\ndata: "한글"}\r\n\r\nevent: command\ndata: {"id":"c"}\n\n',
  );
  const fetcher = async (url: string, options: RequestInit) => {
    expect(url).toBe("/api/admin/playback/events?executorSessionId=browser");
    expect(url.includes("secret")).toBe(false);
    expect(options.headers).toEqual({
      "x-admin-token": "secret",
      Accept: "text/event-stream",
    });
    expect(options.signal).toBe(signal);
    return response(payload);
  };
  const events = await Array.fromAsync(
    playbackEvents("secret", "browser", signal, fetcher),
  );
  expect(events).toEqual([
    { event: "snapshot", id: "1", data: { title: "한글" } },
    { event: "command", id: "1", data: { id: "c" } },
  ]);
});

test("재생 SSE는 단독 CR과 기본 event를 처리하고 불완전한 마지막 프레임은 버려요", async () => {
  const bytes = new TextEncoder().encode("data: 1\r\rdata: 2\r\rdata: 3");
  const fetcher = async () => response(bytes, 3);
  expect(
    await Array.fromAsync(playbackEvents("t", "browser", signal, fetcher)),
  ).toEqual([
    { event: "message", id: null, data: 1 },
    { event: "message", id: null, data: 2 },
  ]);
});

test("재생 SSE는 인증 실패를 연결 성공으로 숨기지 않아요", async () => {
  const fetcher = async () => new Response(null, { status: 401 });
  const iterator = playbackEvents("wrong", "browser", signal, fetcher);
  await expect(iterator.next()).rejects.toBeInstanceOf(PlaybackChannelError);
});

test("권한 철회 뒤 같은 chunk에 남은 명령도 전달하지 않아요", async () => {
  const abort = new AbortController();
  const bytes = new TextEncoder().encode("data: 1\n\ndata: 2\n\n");
  const fetcher = async () => response(bytes, bytes.length);
  const iterator = playbackEvents("t", "browser", abort.signal, fetcher);
  expect((await iterator.next()).value?.data).toBe(1);
  abort.abort();
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
});

test("재생 SSE 중단은 대기 중 read를 깨우고 원본 스트림을 닫아요", async () => {
  const abort = new AbortController();
  const subscribed = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const fetcher = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          subscribed.resolve();
        },
        cancel() {
          cancelled.resolve();
        },
      }),
    );
  const iterator = playbackEvents("t", "browser", abort.signal, fetcher);
  const next = iterator.next();
  await subscribed.promise;
  abort.abort();
  await cancelled.promise;
  expect(await next).toEqual({ value: undefined, done: true });
});
