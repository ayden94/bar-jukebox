import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import type {
  CommandOutcome,
  ConnectedTarget,
  NativeBinding,
  PlaybackCommand,
  PlaybackObservation,
  PlaybackPort,
} from "../../music/contracts";
import { DrizzleQueueRepository } from "../queue/queue.repository";
import { QueueService } from "../queue/queue.service";
import { onChange } from "../shared/bus";
import type { Song } from "../shared/types";
import { PlaybackRepository } from "./playback.repository";
import {
  PlaybackService,
  type PlaybackServiceOptions,
} from "./playback.service";

export const connection: ConnectedTarget = {
  target: { providerId: "test-player", modeId: "local", targetId: "speaker" },
  connectionGeneration: "connection:1",
  location: "server",
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

export async function fixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SCHEMA_DDL);
  const database = drizzle(client);
  const repo = new DrizzleQueueRepository(database);
  const playbackRepo = new PlaybackRepository(database);
  const queue = new QueueService(repo);
  const services: PlaybackService[] = [];
  const runs: Promise<void>[] = [];
  return {
    client,
    repo,
    playbackRepo,
    queue,
    start(
      player: PlaybackPort,
      target: ConnectedTarget | null = connection,
      signal?: AbortSignal,
      stopConfirmationTimeoutMs?: number,
      options?: PlaybackServiceOptions,
    ) {
      const playback = new PlaybackService(
        queue,
        player,
        target,
        playbackRepo,
        { stopConfirmationTimeoutMs, ...options },
      );
      services.push(playback);
      const running = playback.start(signal);
      if (target && target.location !== "server") {
        void playback
          .claimOwner({
            executorSessionId: "explicit-test-executor",
            connection: target,
          })
          .catch(() => undefined);
      }
      // 실패를 검증하는 테스트가 결과를 읽기 전에도 rejection을 처리해요.
      void running.catch(() => undefined);
      runs.push(running);
      return { playback, running };
    },
    async [Symbol.asyncDispose]() {
      await Promise.all(services.map((service) => service.dispose()));
      await Promise.allSettled(runs);
      client.close();
    },
  };
}

export function song(id: string): Song {
  return {
    formatVersion: 1,
    id,
    ref: { providerId: connection.target.providerId, trackId: `Track:${id}` },
    title: id,
    artist: "테스트 가수",
    artwork: null,
    sourceUrl: null,
    durationSec: 200,
    requestedBy: "테이블 1",
    deviceId: `device-${id}`,
    tableId: 1,
    isStaff: true,
    requestedAt: 123,
  };
}

// 상태 변경을 먼저 구독하고 행동해요. 시간 경과를 성공 조건으로 쓰지 않아요.
export function state(
  queue: QueueService,
  matches: (snapshot: ReturnType<QueueService["snapshot"]>) => boolean,
): Promise<void> {
  if (matches(queue.snapshot())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(2000);
    const cleanup = () => {
      unsubscribe();
      timeout.removeEventListener("abort", expired);
    };
    const expired = () => {
      cleanup();
      reject(new Error("예상한 큐 상태를 관측하지 못했어요"));
    };
    const unsubscribe = onChange(() => {
      if (!matches(queue.snapshot())) return;
      cleanup();
      resolve();
    });
    timeout.addEventListener("abort", expired, { once: true });
  });
}

export class FakePlayer implements PlaybackPort {
  readonly calls: PlaybackCommand[] = [];
  autoObserve = true;
  disposed = 0;
  subscribers = 0;
  beforeExecute: ((command: PlaybackCommand) => Promise<void>) | null = null;
  outcome: CommandOutcome["status"] = "accepted";
  failureCode: "disconnected" | "unplayable" = "disconnected";
  private sequence = 0;
  private readonly listeners = new Set<(value: PlaybackObservation) => void>();
  private readonly commands = new Set<() => void>();
  current: PlaybackObservation = {
    ...connection,
    correlation: null,
    trackRef: null,
    binding: null,
    sequence: 0,
    state: "unknown",
    positionSec: null,
    durationSec: null,
  };

  called(type: PlaybackCommand["type"], count = 1): Promise<void> {
    const matches = () =>
      this.calls.filter((command) => command.type === type).length >= count;
    if (matches()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = AbortSignal.timeout(2000);
      const cleanup = () => {
        this.commands.delete(listener);
        timeout.removeEventListener("abort", expired);
      };
      const listener = () => {
        if (!matches()) return;
        cleanup();
        resolve();
      };
      const expired = () => {
        cleanup();
        reject(new Error(`명령을 받지 못했어요: ${type}`));
      };
      this.commands.add(listener);
      timeout.addEventListener("abort", expired, { once: true });
    });
  }

  async execute(
    command: PlaybackCommand,
    signal: AbortSignal,
  ): Promise<CommandOutcome> {
    signal.throwIfAborted();
    this.calls.push(command);
    for (const listener of this.commands) listener();
    await this.beforeExecute?.(command);
    signal.throwIfAborted();
    if (this.outcome === "unknown") {
      return {
        status: "unknown",
        context: command.context,
        error: { code: "unknown-outcome" },
      };
    }
    if (this.outcome === "rejected") {
      return {
        status: "rejected",
        context: command.context,
        error: { code: this.failureCode },
      };
    }
    const { context } = command;
    let observation: PlaybackObservation = {
      ...this.current,
      target: context.target,
      connectionGeneration: context.connectionGeneration,
      correlation: context,
      endReason: undefined,
      state: this.current.state === "ended" ? "playing" : this.current.state,
    };
    if (command.type === "play" || command.type === "restart") {
      observation = {
        ...observation,
        state: command.initialState,
        trackRef:
          command.type === "play" ? command.trackRef : this.current.trackRef,
        binding: {
          providerId: context.target.providerId,
          modeId: context.target.modeId,
          version: 1,
          payload: { nativeId: `native:${context.attemptId}` },
        },
        positionSec: 0,
        durationSec: 200,
      };
    } else if (command.type === "stop") {
      observation = {
        ...observation,
        state: "stopped",
        trackRef: null,
        binding: null,
        positionSec: null,
      };
    } else if (command.type === "pause" || command.type === "resume") {
      observation = {
        ...observation,
        state: command.type === "pause" ? "paused" : "playing",
      };
    }
    this.current = { ...observation, sequence: ++this.sequence };
    if (this.autoObserve) this.deliver(this.current);
    return { status: "accepted", context };
  }

  deliver(observation: PlaybackObservation): void {
    for (const listener of this.listeners) listener(observation);
  }

  report(
    changes: Partial<
      Omit<PlaybackObservation, "state" | "endReason" | "sequence">
    > = {},
    playbackState: Exclude<PlaybackObservation["state"], "ended"> = "playing",
  ): void {
    this.current = {
      ...this.current,
      ...changes,
      state: playbackState,
      endReason: undefined,
      sequence: ++this.sequence,
    };
    this.deliver(this.current);
  }

  end(
    endReason: "natural-end" | "owned-advance" | "replaced" = "natural-end",
  ): void {
    this.current = {
      ...this.current,
      state: "ended",
      endReason,
      sequence: ++this.sequence,
    };
    this.deliver(this.current);
  }

  observe(signal: AbortSignal) {
    this.subscribers += 1;
    const buffered = [this.current];
    let pending:
      | ((value: IteratorResult<PlaybackObservation, undefined>) => void)
      | null = null;
    let closed = false;
    const listener = (value: PlaybackObservation) => {
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ done: false, value });
      } else {
        buffered.push(value);
      }
    };
    const close = () => {
      if (closed) return;
      closed = true;
      this.subscribers -= 1;
      this.listeners.delete(listener);
      signal.removeEventListener("abort", close);
      buffered.length = 0;
      pending?.({ done: true, value: undefined });
      pending = null;
    };
    this.listeners.add(listener);
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();
    const iterator: AsyncIterableIterator<PlaybackObservation, undefined> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        const value = buffered.shift();
        if (value) return Promise.resolve({ done: false as const, value });
        if (closed)
          return Promise.resolve({ done: true as const, value: undefined });
        return new Promise((resolve) => {
          pending = resolve;
        });
      },
      async return() {
        close();
        return { done: true, value: undefined };
      },
    };
    return iterator;
  }

  async reconcile(_binding?: NativeBinding, _signal?: AbortSignal) {
    return {
      ok: true as const,
      value: { status: "match" as const, observation: this.current },
    };
  }

  async dispose(): Promise<void> {
    this.disposed += 1;
  }
}

export async function seedHistory(queue: QueueService): Promise<void> {
  for (const id of ["z", "a"]) {
    await queue.enqueue(song(id));
    await queue.takeAndStart();
    await queue.finishNowPlaying("done", id);
  }
  await queue.enqueue(song("b"));
  await queue.enqueue(song("c"));
}
