// Chrome은 Bun 프로세스마다 하나여서 독립 프로필은 별도 프로세스로 만들어요.
type Message = {
  id: number;
  method: "navigate" | "evaluate" | "close";
  value?: string;
};

if (import.meta.main) {
  const view = new Bun.WebView({
    backend: { type: "chrome", url: false },
    width: 1200,
    height: 800,
  });
  process.on("message", async (message: Message) => {
    try {
      const value =
        message.method === "navigate"
          ? await view.navigate(message.value!)
          : message.method === "evaluate"
            ? await view.evaluate(message.value!)
            : await view[Symbol.asyncDispose]();
      process.send?.({ id: message.id, value }, () => {
        if (message.method === "close") process.disconnect?.();
      });
    } catch (error) {
      process.send?.({ id: message.id, error: String(error) });
    }
  });
}

export function independentBrowser() {
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let nextId = 0;
  let closed = false;
  let output = "";
  const child = Bun.spawn([process.execPath, import.meta.path], {
    stdout: "pipe",
    stderr: "pipe",
    ipc(message: unknown) {
      if (
        !message ||
        typeof message !== "object" ||
        !("id" in message) ||
        typeof message.id !== "number"
      )
        return;
      const request = pending.get(message.id);
      if (!request) return;
      if ("error" in message) request.reject(new Error(String(message.error)));
      else request.resolve("value" in message ? message.value : undefined);
    },
  });
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream)
      output = (output + new TextDecoder().decode(chunk)).slice(-10000);
  };
  const drained = Promise.all([drain(child.stdout), drain(child.stderr)]);
  void child.exited.then(async (code) => {
    await drained;
    for (const request of pending.values())
      request.reject(new Error(`독립 브라우저 종료 (${code}) ${output}`));
  });
  const call = (method: Message["method"], value?: string) => {
    const id = ++nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`독립 브라우저 ${method} 시간 초과`));
      }, 15000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        },
      });
      child.send({ id, method, value });
    });
  };
  return {
    navigate: (url: string) => call("navigate", url),
    async evaluate<T = unknown>(script: string): Promise<T> {
      return (await call("evaluate", script)) as T;
    },
    async [Symbol.asyncDispose]() {
      if (closed) return;
      closed = true;
      try {
        await call("close");
      } finally {
        child.kill();
        await child.exited;
        await drained;
      }
    },
  };
}
