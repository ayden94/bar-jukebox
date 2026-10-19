import { expect, test } from "bun:test";
import type { BrowserCatalogRequest } from "../../domains/music/browser-catalog-protocol";
import type {
  CatalogPage,
  CatalogPort,
  MusicResult,
} from "../../music/contracts";
import { BrowserCatalogExecutor } from "./browser-catalog-executor";
import type { BrowserPlaybackSnapshot } from "./playback-runtime";

const connection = {
  target: { providerId: "fixture", modeId: "browser", targetId: "speaker" },
  connectionGeneration: "generation",
  location: "browser" as const,
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
function requests(count: number): BrowserCatalogRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    requestId: String(index),
    ownerEpoch: 1,
    executorSessionId: "session",
    target: connection.target,
    connectionGeneration: connection.connectionGeneration,
    // 의도적으로 브라우저 시계와 다르게 설정해요.
    deadline: 1,
    remainingMs: 5000,
    operation: { type: "search", query: String(index), cursor: null },
  }));
}
function snapshot(
  catalogRequests: BrowserCatalogRequest[],
): BrowserPlaybackSnapshot {
  return {
    owner: {
      ownerEpoch: 1,
      executorSessionId: "session",
      connection,
      heartbeatAt: 0,
      released: false,
      stopConfirmed: false,
    },
    ownerConnected: true,
    attempt: null,
    commands: [],
    messages: [],
    catalogRequests,
  };
}
function fixture() {
  const starts: string[] = [];
  const aborted: string[] = [];
  const held = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<MusicResult<CatalogPage>>>
  >();
  const reports: unknown[] = [];
  const posted = Promise.withResolvers<void>();
  const port: CatalogPort = {
    search: (query, _cursor, signal) => {
      starts.push(query);
      const result = Promise.withResolvers<MusicResult<CatalogPage>>();
      held.set(query, result);
      const abort = () => {
        aborted.push(query);
        result.reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      return result.promise.finally(() =>
        signal.removeEventListener("abort", abort),
      );
    },
    lookup: async () => ({ ok: false, error: { code: "invalid-track" } }),
  };
  const executor = new BrowserCatalogExecutor({
    connection,
    executorSessionId: "session",
    api: async (_path, init) => {
      reports.push(JSON.parse(String(init?.body)));
      posted.resolve();
      return Response.json({ ok: true });
    },
  });
  executor.setPort(port);
  return { executor, port, starts, aborted, held, reports, posted };
}

test("브라우저 catalog: 32개 snapshot도 4개만 실행하고 제거는 즉시 다음 작업을 시작해요", async () => {
  const f = fixture();
  try {
    const all = requests(32);
    f.executor.update(snapshot(all));
    expect(f.starts).toEqual(["0", "1", "2", "3"]);

    f.executor.update(snapshot(all.slice(1)));

    expect(f.aborted).toEqual(["0"]);
    expect(f.starts).toEqual(["0", "1", "2", "3", "4"]);
    f.executor.update(snapshot(all.slice(1)));
    expect(f.starts).toHaveLength(5);
    f.executor.dispose();
    expect(f.aborted).toEqual(["0", "1", "2", "3", "4"]);
    expect(f.reports).toEqual([]);
  } finally {
    f.executor.dispose();
  }
});

test("브라우저 catalog: 완료 응답은 전체 fence를 echo하고 중복 snapshot은 재실행하지 않아요", async () => {
  const f = fixture();
  try {
    const all = requests(1);
    f.executor.update(snapshot(all));
    f.held
      .get("0")!
      .resolve({ ok: true, value: { tracks: [], nextCursor: null } });
    await f.posted.promise;

    f.executor.update(snapshot(all));

    expect(f.starts).toEqual(["0"]);
    const {
      operation: _operation,
      deadline: _deadline,
      remainingMs: _budget,
      ...fence
    } = all[0]!;
    expect(f.reports).toEqual([
      {
        ...fence,
        result: { ok: true, value: { tracks: [], nextCursor: null } },
      },
    ]);
  } finally {
    f.executor.dispose();
  }
});

test("브라우저 catalog: 포트 교체와 연결 상실은 대기 완료 없이 이전 작업을 취소해요", async () => {
  const f = fixture();
  try {
    const all = requests(1);
    f.executor.update(snapshot(all));
    const never = new Promise<MusicResult<CatalogPage>>(() => {});
    let replacementCalls = 0;
    f.executor.setPort({
      ...f.port,
      search: () => {
        replacementCalls++;
        return never;
      },
    });
    expect(f.aborted).toEqual(["0"]);
    expect(replacementCalls).toBe(0);
    const lost = snapshot(all);
    f.executor.update({ ...lost, ownerConnected: false });
    f.executor.dispose();
    expect(f.reports).toEqual([]);
  } finally {
    f.executor.dispose();
  }
});

test("브라우저 catalog: 서버 남은 예산 만료는 같은 snapshot 반복으로 연장하지 않아요", async () => {
  const aborted = Promise.withResolvers<void>();
  const executor = new BrowserCatalogExecutor({
    connection,
    executorSessionId: "session",
    api: async () => {
      throw new Error("만료된 결과는 보내면 안 돼요");
    },
  });
  executor.setPort({
    search: (_query, _cursor, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted.resolve();
            reject(signal.reason);
          },
          { once: true },
        );
      }),
    lookup: async () => ({ ok: false, error: { code: "invalid-track" } }),
  });
  const request = { ...requests(1)[0]!, remainingMs: 1 };
  try {
    executor.update(snapshot([request]));
    executor.update(snapshot([{ ...request, remainingMs: 5000 }]));
    await aborted.promise;
  } finally {
    executor.dispose();
  }
});

test("브라우저 catalog: 서버가 만료를 알린 snapshot은 로컬 타이머 전에 즉시 취소해요", () => {
  const f = fixture();
  try {
    const request = requests(1)[0]!;
    f.executor.update(snapshot([request]));

    f.executor.update(snapshot([{ ...request, remainingMs: 0 }]));

    expect(f.aborted).toEqual(["0"]);
    expect(f.reports).toEqual([]);
  } finally {
    f.executor.dispose();
  }
});
