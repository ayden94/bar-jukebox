import type {
  CatalogPage,
  CatalogPort,
  MusicResult,
  TrackMetadata,
  TrackRef,
} from "../../music/contracts";
import type { PlaybackOwner } from "../playback/protocol";
import {
  type BrowserCatalogFence,
  type BrowserCatalogOperation,
  type BrowserCatalogRequest,
  sameCatalogFence,
} from "./browser-catalog-protocol";
import {
  catalogText,
  parseCatalogFence,
  parseCatalogPage,
  parseCatalogTrack,
} from "./catalog-result";

type Pending = {
  request: BrowserCatalogRequest;
  accept(value: unknown): boolean;
  cancel(reason: unknown): void;
};

// 일시적인 RPC만 보관해요. 대기열·재생 명령·영속 owner는 재생 서비스가 소유해요.
export class BrowserCatalogBridge implements CatalogPort {
  private context: Omit<BrowserCatalogFence, "requestId"> | null = null;
  private disposed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<() => void>();
  private readonly channels = new Map<string, number>();
  private readonly cursors = new Map<
    string,
    {
      query: string;
      value: string;
      expiresAt: number;
    }
  >();

  constructor(
    private readonly clock: {
      now(): number;
      schedule(callback: () => void, delayMs: number): () => void;
    } = {
      now: Date.now,
      schedule(callback, delay) {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    },
  ) {}

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  openChannel(executorSessionId: string): () => void {
    if (this.disposed) return () => {};
    this.channels.set(
      executorSessionId,
      (this.channels.get(executorSessionId) ?? 0) + 1,
    );
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const remaining = (this.channels.get(executorSessionId) ?? 1) - 1;
      if (remaining > 0) this.channels.set(executorSessionId, remaining);
      else {
        this.channels.delete(executorSessionId);
        if (this.context?.executorSessionId === executorSessionId) {
          this.cursors.clear();
          for (const pending of [...this.pending.values()])
            pending.cancel(
              new DOMException("카탈로그 채널이 닫혔어요", "AbortError"),
            );
          this.notify();
        }
      }
    };
  }

  bindOwner(owner: PlaybackOwner | null): void {
    const next =
      owner && !owner.released && owner.connection.location === "browser"
        ? {
            ownerEpoch: owner.ownerEpoch,
            executorSessionId: owner.executorSessionId,
            target: { ...owner.connection.target },
            connectionGeneration: owner.connection.connectionGeneration,
          }
        : null;
    if (this.context && next && sameCatalogFence(this.context, next)) return;
    this.context = this.disposed ? null : next;
    this.cursors.clear();
    for (const pending of [...this.pending.values()])
      pending.cancel(
        new DOMException("카탈로그 연결이 끝났어요", "AbortError"),
      );
    this.notify();
  }

  requests(executorSessionId: string): BrowserCatalogRequest[] {
    if (this.context?.executorSessionId !== executorSessionId) return [];
    const now = this.clock.now();
    return [...this.pending.values()].map(({ request }) => ({
      ...request,
      remainingMs: Math.max(0, request.deadline - now),
    }));
  }

  private request<T>(
    operation: BrowserCatalogOperation,
    parse: (value: unknown) => MusicResult<T>,
    signal: AbortSignal,
  ): Promise<MusicResult<T>> {
    signal.throwIfAborted();
    if (
      this.disposed ||
      !this.context ||
      !this.channels.has(this.context.executorSessionId)
    )
      return Promise.resolve({ ok: false, error: { code: "disconnected" } });
    if (this.pending.size >= 32)
      return Promise.resolve({ ok: false, error: { code: "rate-limited" } });
    const request: BrowserCatalogRequest = {
      ...this.context,
      requestId: crypto.randomUUID(),
      deadline: this.clock.now() + 5000,
      remainingMs: 5000,
      operation,
    };
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        cancelTimer();
        signal.removeEventListener("abort", aborted);
        this.pending.delete(request.requestId);
      };
      const cancel = (reason: unknown) => {
        cleanup();
        reject(reason);
        this.notify();
      };
      const aborted = () => cancel(signal.reason);
      const cancelTimer = this.clock.schedule(
        () =>
          cancel(
            new DOMException("카탈로그 응답 시간이 지났어요", "TimeoutError"),
          ),
        5000,
      );
      this.pending.set(request.requestId, {
        request,
        cancel,
        accept: (value) => {
          let result: MusicResult<T>;
          try {
            result = parse(value);
          } catch {
            return false;
          }
          cleanup();
          resolve(result);
          this.notify();
          return true;
        },
      });
      signal.addEventListener("abort", aborted, { once: true });
      this.notify();
    });
  }

  search(
    query: string,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<MusicResult<CatalogPage>> {
    signal.throwIfAborted();
    try {
      catalogText(query, 512);
    } catch {
      return Promise.resolve({ ok: false, error: { code: "invalid-track" } });
    }
    for (const [id, entry] of this.cursors)
      if (entry.expiresAt <= this.clock.now()) this.cursors.delete(id);
    const page = cursor === null ? null : this.cursors.get(cursor);
    if (cursor !== null && (!page || page.query !== query))
      return Promise.resolve({ ok: false, error: { code: "invalid-track" } });
    const providerId = this.context?.target.providerId ?? "";
    return this.request(
      { type: "search", query, cursor: page?.value ?? null },
      (value) => {
        const result = parseCatalogPage(value, providerId);
        if (!result.ok || result.value.nextCursor === null) return result;
        if (this.cursors.size >= 256)
          this.cursors.delete(this.cursors.keys().next().value!);
        const handle = crypto.randomUUID();
        this.cursors.set(handle, {
          query,
          value: result.value.nextCursor,
          expiresAt: this.clock.now() + 300000,
        });
        return { ok: true, value: { ...result.value, nextCursor: handle } };
      },
      signal,
    );
  }

  lookup(
    ref: TrackRef,
    signal: AbortSignal,
  ): Promise<MusicResult<TrackMetadata>> {
    signal.throwIfAborted();
    try {
      catalogText(ref.trackId);
    } catch {
      return Promise.resolve({ ok: false, error: { code: "invalid-track" } });
    }
    if (this.context && ref.providerId !== this.context.target.providerId)
      return Promise.resolve({ ok: false, error: { code: "invalid-track" } });
    return this.request(
      {
        type: "lookup",
        ref: { providerId: ref.providerId, trackId: ref.trackId },
      },
      (value) => parseCatalogTrack(value, ref),
      signal,
    );
  }

  acceptResult(fence: unknown, result: unknown): boolean {
    let identity: BrowserCatalogFence;
    try {
      identity = parseCatalogFence(fence);
    } catch {
      return false;
    }
    const pending = this.pending.get(identity.requestId);
    if (
      !pending ||
      !this.context ||
      this.disposed ||
      pending.request.deadline <= this.clock.now() ||
      !sameCatalogFence(identity, pending.request) ||
      !sameCatalogFence(identity, this.context)
    )
      return false;
    return pending.accept(result);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bindOwner(null);
    this.listeners.clear();
    this.channels.clear();
  }
}
