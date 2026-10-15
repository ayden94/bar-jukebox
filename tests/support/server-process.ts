type ServerProcessOptions = {
  readonly command: string[];
  readonly env: Record<string, string | undefined>;
  readonly timeoutMs?: number;
};

// IPC 구독을 spawn 옵션으로 등록해 빠른 시작도 놓치지 않아요.
export async function startServerProcess(options: ServerProcessOptions) {
  const ready = Promise.withResolvers<number>();
  let output = "";
  const child = Bun.spawn(options.command, {
    cwd: process.cwd(),
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
    ipc(message: unknown) {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== "jukebox-ready"
      )
        return;
      if (
        !("port" in message) ||
        typeof message.port !== "number" ||
        !Number.isInteger(message.port) ||
        message.port < 1 ||
        message.port > 65535
      ) {
        ready.reject(new Error("서버 준비 메시지의 포트가 올바르지 않아요"));
        return;
      }
      ready.resolve(message.port);
    },
  });
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      output = (output + decoder.decode(chunk, { stream: true })).slice(-16384);
    }
    output += decoder.decode();
  };
  const drained = Promise.all([drain(child.stdout), drain(child.stderr)]);
  void child.exited.then(async (code) => {
    await drained;
    ready.reject(new Error(`서버가 준비 전에 종료됐어요 (${code})\n${output}`));
  });
  void drained.catch(ready.reject);
  const timeout = setTimeout(() => {
    ready.reject(new Error(`서버 준비 시간이 초과됐어요\n${output}`));
  }, options.timeoutMs ?? 10000);

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill();
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      await child.exited;
      await drained;
    } finally {
      clearTimeout(force);
    }
  };
  try {
    const port = await ready.promise;
    return {
      url: `http://127.0.0.1:${port}`,
      stop,
      get output() {
        return output;
      },
    };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
