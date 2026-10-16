import type {
  ConnectedTarget,
  PlaybackCommand,
  PlaybackContext,
  PlaybackObservation,
  PlaybackPort,
} from "../../music/contracts";
import type { QueueService } from "../queue/queue.service";
import { onChange } from "../shared/bus";
import type { Song } from "../shared/types";

type Attempt = {
  song: Song;
  context: PlaybackContext;
  positionSec: number | null;
};

type ControlVersion = {
  songId: string;
  attemptId: string | undefined;
  transition: number;
};

export class PlaybackService {
  private readonly abort = new AbortController();
  private readonly executorSessionId = crypto.randomUUID();
  private readonly ended = Promise.withResolvers<void>();
  private commandChain: Promise<void> = Promise.resolve();
  private active: Attempt | null = null;
  private latest: PlaybackObservation | null = null;
  private sequence = -1;
  private transition = 0;
  private stopConfirmation: ReturnType<
    typeof Promise.withResolvers<void>
  > | null = null;
  private running: Promise<void> | null = null;
  private disposing: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly queue: QueueService,
    private readonly player: PlaybackPort,
    private readonly connection: ConnectedTarget | null,
    private readonly stopConfirmationTimeoutMs = 12000,
  ) {}

  start(signal?: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    if (!this.connection || this.abort.signal.aborted) return Promise.resolve();
    if (signal?.aborted) return this.dispose();
    this.running = this.run(signal);
    return this.running;
  }

  private async run(signal?: AbortSignal): Promise<void> {
    const abort = () => {
      void this.dispose();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const restored = this.queue.nowPlayingSong();
    if (restored) {
      this.queue.updatePlaybackStatus("reconciliation-required", restored.id);
    }
    const observations = this.consume();
    this.unsubscribe = onChange((event) => {
      if (event === "mutate") this.wake();
    });
    this.wake();
    try {
      await this.ended.promise;
    } finally {
      signal?.removeEventListener("abort", abort);
      await this.dispose();
      await observations;
    }
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.abort.abort();
    this.stopConfirmation?.reject(this.abort.signal.reason);
    this.stopConfirmation = null;
    this.ended.resolve();
    this.disposing = this.player.dispose().then(() => this.commandChain);
    return this.disposing;
  }

  pause(): Promise<void> {
    return this.control(async (active) => {
      await this.execute(active, { type: "pause", context: active.context });
    });
  }

  resume(): Promise<void> {
    return this.control(async (active) => {
      await this.execute(active, { type: "resume", context: active.context });
    });
  }

  skip(): Promise<void> {
    return this.control(async (active) => {
      this.transition += 1;
      await this.stop(active);
      await this.finish(active);
    });
  }

  // 운영자가 실제 오디오 정지를 확인한 현재 신청만 완료해요.
  confirmStopped(expectedSongId: string): Promise<boolean> {
    const transition = this.transition;
    const attemptId = this.active?.context.attemptId;
    return this.command(async () => {
      const current = this.queue.snapshot().nowPlaying;
      if (
        this.abort.signal.aborted ||
        !current ||
        current.song.id !== expectedSongId ||
        this.transition !== transition ||
        this.active?.context.attemptId !== attemptId ||
        (current.status !== "waiting" &&
          current.status !== "reconciliation-required")
      )
        return false;
      const finished = await this.queue.finishNowPlaying(
        "done",
        expectedSongId,
      );
      if (!finished) return false;
      this.active = null;
      this.latest = null;
      this.transition += 1;
      if (this.running && this.connection) this.wake();
      return true;
    });
  }

  previous(): Promise<void> {
    return this.control(async (active) => {
      const snapshot = this.queue.snapshot();
      const current = snapshot.nowPlaying;
      if (!current || active.positionSec === null) {
        throw new Error("현재 재생 위치를 확인할 수 없어요");
      }
      const candidate = snapshot.history[0];
      const restart =
        active.positionSec >= 3 ||
        !candidate ||
        candidate.ref.providerId !== active.song.ref.providerId;
      const initialState = current.status === "paused" ? "paused" : "playing";
      this.transition += 1;
      // 다른 요청으로 넘어갈 때는 현재 실행의 정지를 먼저 확인해요.
      if (!restart) await this.stop(active);
      let previous: Song | null;
      try {
        previous = await this.queue.previous(active.song.id, restart);
      } catch (error) {
        this.queue.updatePlaybackStatus("waiting", active.song.id);
        throw error;
      }
      if (!previous || this.abort.signal.aborted) return;
      const next = this.attempt(previous);
      this.active = next;
      this.queue.updatePlaybackStatus("starting", previous.id);
      await this.execute(
        next,
        restart
          ? { type: "restart", initialState, context: next.context }
          : {
              type: "play",
              trackRef: previous.ref,
              initialState,
              context: next.context,
            },
      );
    });
  }

  private control(work: (active: Attempt) => Promise<void>): Promise<void> {
    if (!this.connection) {
      return this.queue.nowPlayingSong()
        ? Promise.reject(new Error("재생 기기가 연결되지 않았어요"))
        : Promise.resolve();
    }
    const song = this.queue.nowPlayingSong();
    const version: ControlVersion | null = song
      ? {
          songId: song.id,
          attemptId: this.active?.context.attemptId,
          transition: this.transition,
        }
      : null;
    return this.command(async () => {
      if (
        !version ||
        this.abort.signal.aborted ||
        this.queue.nowPlayingSong()?.id !== version.songId ||
        this.transition !== version.transition ||
        this.active?.context.attemptId !== version.attemptId
      ) {
        return;
      }
      const active = this.active ?? (await this.recover());
      if (!active) {
        throw new Error("현재 재생을 확인한 뒤 다시 시도해 주세요");
      }
      await work(active);
    });
  }

  private attempt(song: Song): Attempt {
    if (!this.connection) throw new Error("재생 기기가 연결되지 않았어요");
    return {
      song,
      positionSec: null,
      context: {
        commandId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
        executorSessionId: this.executorSessionId,
        target: this.connection.target,
        connectionGeneration: this.connection.connectionGeneration,
      },
    };
  }

  private wake(): void {
    if (this.abort.signal.aborted) return;
    void this.command(async () => {
      if (
        this.abort.signal.aborted ||
        this.queue.nowPlayingSong() ||
        this.queue.hasProviderConflict()
      ) {
        return;
      }
      const song = await this.queue.takeAndStart();
      if (!song || this.abort.signal.aborted) return;
      const active = this.attempt(song);
      this.active = active;
      this.transition += 1;
      try {
        await this.execute(active, {
          type: "play",
          trackRef: song.ref,
          initialState: "playing",
          context: active.context,
        });
      } catch {
        // 적용 여부 불명이나 연결 오류는 신청을 없애거나 자동 재전송하지 않아요.
      }
    }).catch((error: unknown) => this.ended.reject(error));
  }

  private async execute(
    active: Attempt,
    input: PlaybackCommand,
    signal = this.abort.signal,
  ): Promise<void> {
    const context = {
      ...active.context,
      commandId: crypto.randomUUID(),
    };
    active.context = context;
    try {
      const outcome = await this.player.execute({ ...input, context }, signal);
      signal.throwIfAborted();
      if (
        outcome.context.commandId !== context.commandId ||
        outcome.context.attemptId !== context.attemptId ||
        outcome.context.executorSessionId !== context.executorSessionId ||
        !this.matchesTarget(outcome.context)
      ) {
        this.queue.updatePlaybackStatus(
          "reconciliation-required",
          active.song.id,
        );
        throw new Error("재생 명령 결과를 확인할 수 없어요");
      }
      if (outcome.status !== "accepted") {
        this.queue.updatePlaybackStatus(
          outcome.status === "unknown" ? "reconciliation-required" : "waiting",
          active.song.id,
        );
        throw new Error(outcome.error.code);
      }
    } catch (error) {
      const status = this.queue.snapshot().nowPlaying?.status;
      if (
        !this.abort.signal.aborted &&
        status !== "waiting" &&
        status !== "reconciliation-required"
      ) {
        this.queue.updatePlaybackStatus(
          "reconciliation-required",
          active.song.id,
        );
      }
      throw error;
    }
  }

  private async stop(active: Attempt): Promise<void> {
    const confirmation = Promise.withResolvers<void>();
    this.stopConfirmation = confirmation;
    const deadline = new AbortController();
    const expiration = Promise.withResolvers<never>();
    const expired = () => expiration.reject(deadline.signal.reason);
    deadline.signal.addEventListener("abort", expired, { once: true });
    const timeout = setTimeout(
      () => deadline.abort(new Error("정지 확인 시간이 초과됐어요")),
      this.stopConfirmationTimeoutMs,
    );
    const signal = AbortSignal.any([this.abort.signal, deadline.signal]);
    // execute 실패가 관측보다 먼저 도착해도 미처리 rejection을 만들지 않아요.
    void confirmation.promise.catch(() => undefined);
    try {
      const executing = this.execute(
        active,
        { type: "stop", context: active.context },
        signal,
      );
      await Promise.race([
        Promise.all([executing, confirmation.promise]),
        expiration.promise,
      ]);
      this.abort.signal.throwIfAborted();
    } catch (error) {
      if (deadline.signal.aborted) {
        this.queue.updatePlaybackStatus(
          "reconciliation-required",
          active.song.id,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      deadline.signal.removeEventListener("abort", expired);
      if (this.stopConfirmation === confirmation) {
        this.stopConfirmation = null;
      }
    }
  }

  private async finish(active: Attempt): Promise<void> {
    try {
      await this.queue.finishNowPlaying("done", active.song.id);
      this.active = null;
      this.wake();
    } catch (error) {
      this.queue.updatePlaybackStatus("waiting", active.song.id);
      throw error;
    }
  }

  private matchesTarget(value: {
    target: PlaybackObservation["target"];
    connectionGeneration: string | null;
  }): boolean {
    if (!this.connection) return false;
    const expected = this.connection.target;
    return (
      value.target?.providerId === expected.providerId &&
      value.target.modeId === expected.modeId &&
      value.target.targetId === expected.targetId &&
      value.connectionGeneration === this.connection.connectionGeneration
    );
  }

  private matches(observation: PlaybackObservation, active: Attempt): boolean {
    return (
      this.matchesTarget(observation) &&
      observation.correlation?.attemptId === active.context.attemptId &&
      observation.correlation.executorSessionId ===
        active.context.executorSessionId &&
      observation.correlation.commandId === active.context.commandId
    );
  }

  private async consume(): Promise<void> {
    try {
      for await (const observation of this.player.observe(this.abort.signal)) {
        if (this.abort.signal.aborted) break;
        if (!this.matchesTarget(observation)) continue;
        if (observation.sequence <= this.sequence) continue;
        this.latest = observation;
        const active = this.active;
        if (!active || !this.matches(observation, active)) continue;
        this.sequence = observation.sequence;
        // 정지 확인은 명령 체인 밖에서 깨워요. 같은 체인에서 기다리면 교착돼요.
        if (this.stopConfirmation && observation.state === "stopped") {
          this.stopConfirmation.resolve();
          continue;
        }
        void this.command(async () => {
          if (
            this.abort.signal.aborted ||
            this.active !== active ||
            !this.matches(observation, active)
          ) {
            return;
          }
          await this.observe(active, observation);
        }).catch((error: unknown) => this.ended.reject(error));
      }
      if (!this.abort.signal.aborted) {
        const current = this.queue.nowPlayingSong();
        if (current) this.queue.updatePlaybackStatus("waiting", current.id);
        this.stopConfirmation?.reject(new Error("재생 관측이 끝났어요"));
        this.ended.resolve();
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.stopConfirmation?.reject(error);
        this.ended.reject(error);
      }
    }
  }

  private async observe(
    active: Attempt,
    observation: PlaybackObservation,
  ): Promise<void> {
    const matchesTrack =
      observation.trackRef?.providerId === active.song.ref.providerId &&
      observation.trackRef.trackId === active.song.ref.trackId;
    if (!matchesTrack || observation.state === "unknown") {
      this.queue.updatePlaybackStatus(
        "reconciliation-required",
        active.song.id,
      );
      return;
    }
    active.positionSec = observation.positionSec;
    if (observation.positionSec !== null) {
      this.queue.updateProgress(
        observation.positionSec,
        observation.durationSec,
        active.song.id,
      );
    }
    switch (observation.state) {
      case "playing":
      case "paused":
        this.queue.updatePlaybackStatus(observation.state, active.song.id);
        break;
      case "buffering":
      case "interrupted":
      case "unavailable":
      case "stopped":
        this.queue.updatePlaybackStatus("waiting", active.song.id);
        break;
      case "ended":
        this.transition += 1;
        try {
          await this.stop(active);
        } catch {
          return;
        }
        await this.finish(active);
        break;
    }
  }

  private async recover(): Promise<Attempt | null> {
    const song = this.queue.nowPlayingSong();
    const observed = this.latest;
    if (
      !this.connection ||
      !song ||
      song.ref.providerId !== this.connection.target.providerId ||
      !observed?.binding ||
      !observed.correlation ||
      observed.trackRef?.providerId !== song.ref.providerId ||
      observed.trackRef.trackId !== song.ref.trackId
    ) {
      return null;
    }
    const result = await this.player.reconcile(
      observed.binding,
      this.abort.signal,
    );
    if (!result.ok || result.value.status !== "match") return null;
    const observation = result.value.observation;
    if (
      !this.matchesTarget(observation) ||
      observation.trackRef?.providerId !== song.ref.providerId ||
      observation.trackRef.trackId !== song.ref.trackId ||
      !observation.correlation ||
      (observation.state !== "playing" && observation.state !== "paused")
    ) {
      return null;
    }
    const active: Attempt = {
      song,
      context: {
        ...observation.correlation,
        target: this.connection.target,
        connectionGeneration: this.connection.connectionGeneration,
      },
      positionSec: observation.positionSec,
    };
    this.active = active;
    this.sequence = observation.sequence;
    await this.observe(active, observation);
    return active;
  }

  private command<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(task);
    this.commandChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
