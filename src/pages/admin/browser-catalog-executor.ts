import {
  type BrowserCatalogRequest,
  sameCatalogFence,
} from "../../domains/music/browser-catalog-protocol";
import type {
  CatalogPage,
  CatalogPort,
  ConnectedTarget,
  MusicResult,
  TrackMetadata,
} from "../../music/contracts";
import type { BrowserPlaybackSnapshot } from "./playback-runtime";

type Work = {
  request: BrowserCatalogRequest;
  abort: AbortController;
  cancelTimer(): void;
  state: "waiting" | "running" | "done";
};

// 검색 수명은 재생 commands Promise와 분리해요. 취소는 포트의 완료를 기다리지 않아요.
export class BrowserCatalogExecutor {
  private port: CatalogPort | null = null;
  private snapshot: BrowserPlaybackSnapshot | null = null;
  private readonly work = new Map<string, Work>();
  private disposed = false;

  constructor(
    private readonly options: {
      connection: ConnectedTarget;
      executorSessionId: string;
      api(path: string, init?: RequestInit): Promise<Response>;
    },
  ) {}

  setPort(port: CatalogPort | null): void {
    // 등록 교체는 이미 발행한 요청을 새 포트에 재전송하지 않아요.
    for (const work of this.work.values()) this.cancel(work);
    this.port = this.disposed ? null : port;
    if (this.snapshot && this.port) this.update(this.snapshot);
  }

  update(snapshot: BrowserPlaybackSnapshot): void {
    this.snapshot = snapshot;
    if (this.disposed || !this.port) return;
    const owner = snapshot.owner;
    const fence = owner && {
      ownerEpoch: owner.ownerEpoch,
      executorSessionId: this.options.executorSessionId,
      target: this.options.connection.target,
      connectionGeneration: this.options.connection.connectionGeneration,
    };
    if (
      !owner ||
      owner.released ||
      !snapshot.ownerConnected ||
      owner.executorSessionId !== this.options.executorSessionId ||
      !fence ||
      !sameCatalogFence(fence, {
        ...owner,
        target: owner.connection.target,
        connectionGeneration: owner.connection.connectionGeneration,
      })
    ) {
      this.cancelAll();
      return;
    }
    const requests = snapshot.catalogRequests ?? [];
    const current = new Map(
      requests.map((request) => [request.requestId, request]),
    );
    for (const [id, work] of this.work) {
      const request = current.get(id);
      if (
        !request ||
        request.remainingMs <= 0 ||
        !sameCatalogFence(request, fence)
      ) {
        this.cancel(work);
        if (!request) this.work.delete(id);
      }
    }
    for (const request of requests) {
      if (
        this.work.has(request.requestId) ||
        this.work.size >= 32 ||
        !sameCatalogFence(request, fence) ||
        !Number.isFinite(request.remainingMs) ||
        request.remainingMs <= 0 ||
        request.remainingMs > 5000
      )
        continue;
      const abort = new AbortController();
      const timer = setTimeout(() => {
        this.cancel(work);
        this.pump();
      }, request.remainingMs);
      const work: Work = {
        request,
        abort,
        cancelTimer: () => clearTimeout(timer),
        state: "waiting",
      };
      this.work.set(request.requestId, work);
    }
    this.pump();
  }

  private cancel(work: Work): void {
    work.state = "done";
    work.cancelTimer();
    work.abort.abort();
  }

  private cancelAll(): void {
    for (const work of this.work.values()) this.cancel(work);
    this.work.clear();
  }

  private pump(): void {
    if (!this.port || this.disposed) return;
    let running = [...this.work.values()].filter(
      (work) => work.state === "running",
    ).length;
    for (const work of this.work.values()) {
      if (running >= 4) break;
      if (work.state !== "waiting") continue;
      running++;
      work.state = "running";
      void this.execute(work, this.port);
    }
  }

  private async execute(work: Work, port: CatalogPort): Promise<void> {
    const request = work.request;
    const signal = work.abort.signal;
    let result: MusicResult<CatalogPage | TrackMetadata>;
    try {
      const operation = request.operation;
      result =
        operation.type === "search"
          ? await port.search(operation.query, operation.cursor, signal)
          : await port.lookup(operation.ref, signal);
    } catch {
      result = { ok: false, error: { code: "disconnected" } };
    }
    try {
      if (signal.aborted || this.work.get(request.requestId) !== work) return;
      await this.options.api("/api/admin/music/catalog-result", {
        method: "POST",
        body: JSON.stringify({
          requestId: request.requestId,
          ownerEpoch: request.ownerEpoch,
          executorSessionId: request.executorSessionId,
          target: request.target,
          connectionGeneration: request.connectionGeneration,
          result,
        }),
        signal,
      });
    } catch {
      // 응답이 불명이어도 재전송하지 않아요. 서버 deadline이 요청을 정리해요.
    } finally {
      this.cancel(work);
      this.pump();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.port = null;
    this.snapshot = null;
    this.cancelAll();
  }
}
