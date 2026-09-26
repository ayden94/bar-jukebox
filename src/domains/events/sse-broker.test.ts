import { expect, test } from "bun:test";
import { SseBroker } from "./sse-broker";

test("변경 알림 후 대기자를 정리해요", async () => {
  const broker = new SseBroker();
  const change = broker.waitChange();
  broker.notify();
  expect(await change).toBe("change");
  expect(broker.pendingCount).toBe(0);
});

test("연결 종료는 대기 중인 구독을 즉시 해제해요", async () => {
  const broker = new SseBroker();
  const controller = new AbortController();
  const change = broker.waitChange(controller.signal);
  controller.abort();
  expect(await change).toBe("closed");
  expect(broker.pendingCount).toBe(0);
});

test("ping 타임아웃도 대기자를 남기지 않아요", async () => {
  const broker = new SseBroker();
  expect(await broker.waitChange(undefined, 0)).toBe("ping");
  expect(broker.pendingCount).toBe(0);
});

test("이미 종료한 연결은 대기자를 등록하지 않아요", async () => {
  const broker = new SseBroker();
  expect(await broker.waitChange(AbortSignal.abort())).toBe("closed");
  expect(broker.pendingCount).toBe(0);
});
