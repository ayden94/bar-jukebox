import { expect, test } from "bun:test";
import { startServerProcess } from "./server-process";

test("서버 준비: 즉시 전달된 IPC 포트로 실제 HTTP 서버에 접속해요", async () => {
  const server = await startServerProcess({
    command: [
      process.execPath,
      "-e",
      `
      const server = Bun.serve({ port: 0, fetch: () => new Response("ready") });
      process.send({ type: "jukebox-ready", port: server.port });
    `,
    ],
    env: {},
  });
  try {
    const response = await fetch(server.url);
    expect(await response.text()).toBe("ready");
  } finally {
    await server.stop();
  }
});

test("서버 준비: 조기 정상 종료도 원인과 함께 실패해요", async () => {
  await expect(
    startServerProcess({
      command: [
        process.execPath,
        "-e",
        'console.error("fixture-exit"); process.exit(0)',
      ],
      env: {},
    }),
  ).rejects.toThrow("fixture-exit");
});

test("서버 준비: 잘못된 포트는 서버 준비 성공으로 처리하지 않아요", async () => {
  await expect(
    startServerProcess({
      command: [
        process.execPath,
        "-e",
        'process.send({ type: "jukebox-ready", port: 0 });',
      ],
      env: {},
    }),
  ).rejects.toThrow("포트");
});

test("서버 준비: IPC 없는 서버는 제한 시간에 종료해요", async () => {
  await expect(
    startServerProcess({
      command: [
        process.execPath,
        "-e",
        'Bun.serve({ port: 0, fetch: () => new Response("no signal") });',
      ],
      env: {},
      timeoutMs: 100,
    }),
  ).rejects.toThrow("준비 시간이 초과");
});
