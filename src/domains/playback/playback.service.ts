import type {
  CommandOutcome,
  ConnectedTarget,
  ConnectionPort,
  MusicResult,
  PlaybackCommand,
  PlaybackContext,
  PlaybackObservation,
  PlaybackPort,
  PlaybackTarget,
} from "../../music/contracts";
import type { QueueService } from "../queue/queue.service";
import { emit, onChange } from "../shared/bus";
import type { Song } from "../shared/types";
import type { PlaybackRepository } from "./playback.repository";
import type {
  DurableAttempt,
  DurableCommand,
  OwnerClaim,
  OwnerIdentity,
  PlaybackFence,
  PlaybackOwner,
  PlaybackReservation,
  PlaybackSnapshot,
} from "./protocol";

type Attempt = DurableAttempt & { song: Song };

export type PlaybackServiceOptions = {
  stopConfirmationTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  now?: () => number;
  onOwnerChange?: (owner: PlaybackOwner | null) => void;
  browserMode?: { providerId: string; modeId: string };
  serverMode?: { providerId: string; modeId: string };
  serverConnection?: ConnectionPort;
};

export class PlaybackService {
  private readonly abort = new AbortController();
  private readonly executorSessionId = crypto.randomUUID();
  private readonly ended = Promise.withResolvers<void>();
  private readonly now: () => number;
  private commandChain: Promise<void> = Promise.resolve();
  private active: Attempt | null = null;
  private owner: PlaybackOwner | null = null;
  private transition = 0;
  private stopConfirmation: {
    attemptId: string;
    commandId: string | null;
    completion: ReturnType<typeof Promise.withResolvers<void>>;
  } | null = null;
  private running: Promise<void> | null = null;
  private disposing: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly queue: QueueService,
    private readonly player: PlaybackPort,
    private connection: ConnectedTarget | null,
    private readonly repository: PlaybackRepository,
    private readonly options: PlaybackServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  start(signal?: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    if (
      (!this.connection &&
        !this.options.browserMode &&
        !this.options.serverMode) ||
      this.abort.signal.aborted
    )
      return Promise.resolve();
    if (signal?.aborted) return this.dispose();
    const restored = this.queue.nowPlayingSong();
    if (restored)
      this.queue.updatePlaybackStatus("reconciliation-required", restored.id);
    this.running = this.run(signal);
    return this.running;
  }

  private async run(signal?: AbortSignal): Promise<void> {
    const abort = () => {
      void this.dispose();
    };
    signal?.addEventListener("abort", abort, { once: true });
    let observations: Promise<void> | undefined;
    try {
      await this.command(async () => {
        this.owner = await this.repository.loadOwner();
        const restored = await this.repository.recover();
        const song = this.queue.nowPlayingSong();
        if (restored && song?.id === restored.songId) {
          this.active = { ...restored, song };
          this.queue.applyPlayback(restored);
        }
        await this.selectServerOwner();
        this.options.onOwnerChange?.(this.owner);
        if (this.active && this.owner && !this.owner.released) {
          const commands = await this.repository.loadCommands(
            this.active.attemptId,
          );
          const current = commands.find(
            (command) =>
              command.command.context.commandId ===
              this.active?.context.commandId,
          );
          if (current?.state === "confirmed") await this.recover();
        }
      });
      if (this.abort.signal.aborted) return;
      observations = this.consume();
      this.unsubscribe = onChange((event) => {
        if (event === "mutate") this.wake();
      });
      this.wake();
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
    this.stopConfirmation?.completion.reject(this.abort.signal.reason);
    this.stopConfirmation = null;
    this.ended.resolve();
    this.disposing = this.player.dispose().then(() => this.commandChain);
    return this.disposing;
  }

  async snapshot(): Promise<PlaybackSnapshot> {
    const { owner, attempt, commands } = await this.repository.snapshot();
    const serverConnected =
      this.connection?.location === "server" &&
      owner?.connection.location === "server" &&
      this.connection.connectionGeneration ===
        owner.connection.connectionGeneration &&
      this.connection.target.providerId ===
        owner.connection.target.providerId &&
      this.connection.target.modeId === owner.connection.target.modeId &&
      this.connection.target.targetId === owner.connection.target.targetId;
    return {
      owner,
      ownerConnected:
        owner !== null &&
        !owner.released &&
        (owner.connection.location === "server"
          ? serverConnected
          : this.now() - owner.heartbeatAt <
            (this.options.heartbeatTimeoutMs ?? 15000)),
      attempt,
      commands: commands.filter(
        (command) =>
          command.state !== "confirmed" && command.state !== "rejected",
      ),
    };
  }

  claimOwner(claim: OwnerClaim): Promise<PlaybackOwner> {
    return this.command(async () => {
      this.abort.signal.throwIfAborted();
      const selected =
        this.connection?.target ??
        this.options.browserMode ??
        this.options.serverMode;
      const location =
        this.connection?.location ??
        (this.options.browserMode
          ? "browser"
          : this.options.serverMode
            ? "server"
            : null);
      if (
        !selected ||
        claim.connection.target.providerId !== selected.providerId ||
        claim.connection.target.modeId !== selected.modeId ||
        claim.connection.location !== location
      ) {
        throw new Error("설정된 재생 방식과 다른 기기예요");
      }
      const capabilities = claim.connection.capabilities;
      if (
        !capabilities.canPlayExactTrack ||
        !capabilities.canPause ||
        !capabilities.canResume ||
        !capabilities.canStop ||
        !capabilities.canRestart ||
        !capabilities.canObserveEnd
      ) {
        throw new Error("주크박스에 필요한 재생 기능을 지원하지 않아요");
      }
      if (this.queue.hasProviderConflict())
        throw new Error("활성 신청의 음악 서비스가 달라요");
      this.owner = await this.repository.claim(claim, this.now());
      this.options.onOwnerChange?.(this.owner);
      emit("mutate");
      this.wake();
      return this.owner;
    });
  }

  heartbeat(identity: OwnerIdentity): Promise<PlaybackOwner> {
    return this.command(async () => {
      this.owner = await this.repository.heartbeat(identity, this.now());
      emit("mutate");
      return this.owner;
    });
  }

  releaseOwner(identity: OwnerIdentity): Promise<boolean> {
    return this.command(() => this.release(identity));
  }

  private async release(identity: OwnerIdentity): Promise<boolean> {
    if (!(await this.authorize(identity))) return false;
    if (this.queue.nowPlayingSong()) {
      const active = this.active ?? (await this.recover());
      if (!active) throw new Error("실제 오디오 정지를 먼저 확인해 주세요");
      this.transition += 1;
      await this.stop(active);
      await this.finish(active);
    }
    this.owner = await this.repository.release(identity);
    this.options.onOwnerChange?.(this.owner);
    emit("mutate");
    return true;
  }

  connectTarget(
    target: PlaybackTarget,
    signal: AbortSignal,
  ): Promise<MusicResult<void>> {
    return this.command(async () => {
      const selected = this.options.serverMode;
      const port = this.options.serverConnection;
      signal.throwIfAborted();
      if (
        !selected ||
        !port ||
        this.abort.signal.aborted ||
        target.providerId !== selected.providerId ||
        target.modeId !== selected.modeId
      )
        return { ok: false, error: { code: "unsupported" } };
      if (this.owner && !this.owner.released) {
        return { ok: false, error: { code: "configuration" } };
      }
      if (this.queue.hasProviderConflict())
        return { ok: false, error: { code: "configuration" } };
      const result = await port.connect(target, signal);
      if (!result.ok) return result;
      const connection = result.value;
      if (
        connection.location !== "server" ||
        connection.target.providerId !== target.providerId ||
        connection.target.modeId !== target.modeId ||
        connection.target.targetId !== target.targetId ||
        !connection.capabilities.canPlayExactTrack ||
        !connection.capabilities.canPause ||
        !connection.capabilities.canResume ||
        !connection.capabilities.canStop ||
        !connection.capabilities.canRestart ||
        !connection.capabilities.canObserveEnd
      )
        return { ok: false, error: { code: "unsupported" } };
      this.connection = connection;
      this.owner = await this.repository.claim(
        {
          connection,
          executorSessionId: this.executorSessionId,
        },
        this.now(),
      );
      this.options.onOwnerChange?.(this.owner);
      emit("mutate");
      this.wake();
      return { ok: true, value: undefined };
    });
  }

  disconnectTarget(signal: AbortSignal): Promise<MusicResult<void>> {
    return this.command(async () => {
      const port = this.options.serverConnection;
      signal.throwIfAborted();
      if (!port || this.abort.signal.aborted)
        return { ok: false, error: { code: "unsupported" } };
      if (
        this.owner &&
        !this.owner.released &&
        !(await this.release(this.owner))
      ) {
        return { ok: false, error: { code: "disconnected" } };
      }
      const result = await port.disconnect(signal);
      if (!result.ok) return result;
      this.connection = null;
      emit("mutate");
      return result;
    });
  }

  async authorize(
    identity: OwnerIdentity,
    attemptId?: string,
  ): Promise<boolean> {
    const owner = await this.repository.loadOwner();
    if (
      this.abort.signal.aborted ||
      !owner ||
      owner.released ||
      owner.ownerEpoch !== identity.ownerEpoch ||
      owner.executorSessionId !== identity.executorSessionId
    )
      return false;
    if (attemptId !== undefined) {
      const attempt = await this.repository.loadAttempt();
      if (
        !attempt ||
        attempt.attemptId !== attemptId ||
        attempt.ownerEpoch !== identity.ownerEpoch ||
        attempt.context.executorSessionId !== identity.executorSessionId
      )
        return false;
    }
    return true;
  }

  // execute가 이 receipt를 기다리므로 명령 체인 밖에서 저장해요.
  async receipt(
    identity: OwnerIdentity,
    outcome: CommandOutcome,
  ): Promise<boolean> {
    const active = this.active;
    if (
      !active ||
      !this.matchesIdentity(identity, active) ||
      !this.matchesContext(outcome.context, active) ||
      !(await this.authorize(identity, active.attemptId))
    )
      return false;
    await this.repository.setCommandState(
      this.fence(active),
      outcome.context.commandId,
      outcome.status === "accepted"
        ? "received"
        : outcome.status === "unknown"
          ? "unknown"
          : "rejected",
      this.now(),
    );
    emit("mutate");
    return true;
  }

  observation(
    identity: OwnerIdentity,
    observation: PlaybackObservation,
  ): Promise<boolean> {
    const active = this.active;
    if (
      !active ||
      !this.matchesIdentity(identity, active) ||
      !this.matches(observation, active)
    )
      return Promise.resolve(false);
    const confirmation = this.stopConfirmation;
    if (
      confirmation &&
      observation.state === "stopped" &&
      confirmation.attemptId === active.attemptId &&
      confirmation.commandId === observation.correlation?.commandId
    ) {
      // 정지 명령은 이 관측을 기다려요. 저장 성공 뒤에만 대기를 풀어요.
      return this.applyObservation(active, observation).then(
        (applied) => {
          if (applied) confirmation.completion.resolve();
          return applied;
        },
        (error: unknown) => {
          confirmation.completion.reject(error);
          throw error;
        },
      );
    }
    return this.command(async () => {
      if (
        this.active?.attemptId !== active.attemptId ||
        !this.matches(observation, this.active)
      )
        return false;
      const applied = await this.applyObservation(this.active, observation);
      if (
        applied &&
        observation.state === "ended" &&
        observation.trackRef?.providerId === active.song.ref.providerId &&
        observation.trackRef.trackId === active.song.ref.trackId
      ) {
        this.transition += 1;
        // POST 응답을 먼저 끝내야 같은 실행기가 후속 정지 관측을 보낼 수 있어요.
        const endedCommandId = observation.correlation?.commandId;
        void this.command(async () => {
          const current = this.active;
          if (
            !current ||
            current.attemptId !== active.attemptId ||
            current.context.commandId !== endedCommandId
          )
            return;
          try {
            await this.stop(current);
          } catch {
            return;
          }
          await this.finish(this.active ?? current);
        }).catch((error: unknown) => this.ended.reject(error));
      }
      return applied;
    });
  }

  reconcile(identity: OwnerIdentity): Promise<boolean> {
    return this.command(async () => {
      if (!(await this.authorize(identity))) return false;
      return (await this.recover()) !== null;
    });
  }

  pause(): Promise<void> {
    return this.control((active) =>
      this.execute(active, { type: "pause", context: active.context }),
    );
  }

  resume(): Promise<void> {
    return this.control((active) =>
      this.execute(active, { type: "resume", context: active.context }),
    );
  }

  skip(): Promise<void> {
    return this.control(async (active) => {
      this.transition += 1;
      await this.stop(active);
      await this.finish(this.active ?? active);
    });
  }

  // 운영자가 물리적으로 정지한 시도/세대만 완료해요.
  confirmStopped(
    expectedSongId: string,
    expected?: { attemptId: string | null; ownerEpoch: number },
  ): Promise<boolean> {
    const transition = this.transition;
    const capturedAttempt = this.active?.attemptId ?? null;
    return this.command(async () => {
      const current = this.queue.snapshot().nowPlaying;
      const attemptId = this.active?.attemptId ?? null;
      const owner = await this.repository.loadOwner();
      if (
        this.abort.signal.aborted ||
        !current ||
        current.song.id !== expectedSongId ||
        this.transition !== transition ||
        (attemptId !== null && expected === undefined) ||
        (capturedAttempt !== null && capturedAttempt !== attemptId) ||
        (expected &&
          (expected.attemptId !== attemptId ||
            expected.ownerEpoch !== (owner?.ownerEpoch ?? 0))) ||
        (current.status !== "waiting" &&
          current.status !== "reconciliation-required")
      )
        return false;
      const fence =
        owner && !owner.released
          ? {
              ownerEpoch: owner.ownerEpoch,
              executorSessionId: owner.executorSessionId,
              attemptId,
            }
          : undefined;
      const finished = await this.queue.finishNowPlaying(
        "done",
        expectedSongId,
        fence,
        this.now(),
      );
      if (!finished) return false;
      this.active = null;
      this.transition += 1;
      this.owner = await this.repository.loadOwner();
      await this.selectServerOwner();
      if (this.running) this.wake();
      return true;
    });
  }

  previous(): Promise<void> {
    return this.control(async (active) => {
      const snapshot = this.queue.snapshot();
      const current = snapshot.nowPlaying;
      if (!current || active.positionSec === null)
        throw new Error("현재 재생 위치를 확인할 수 없어요");
      const candidate = snapshot.history[0];
      const restart =
        active.positionSec >= 3 ||
        !candidate ||
        candidate.ref.providerId !== active.song.ref.providerId;
      const initialState = current.status === "paused" ? "paused" : "playing";
      this.transition += 1;
      if (!restart) await this.stop(active);
      let reservation: PlaybackReservation | undefined;
      let song: Song | null;
      try {
        song = await this.queue.previous(
          active.song.id,
          restart,
          (nextSong) => {
            reservation = this.reserve(
              nextSong,
              restart ? "restart" : "play",
              initialState,
              active.attemptId,
            );
            return reservation;
          },
        );
      } catch (error) {
        await this.setStatus(this.active ?? active, "waiting");
        throw error;
      }
      if (!song || !reservation || this.abort.signal.aborted) return;
      this.active = { ...reservation.attempt, song };
      await this.execute(this.active, reservation.command.command, true);
    });
  }

  private control(work: (active: Attempt) => Promise<void>): Promise<void> {
    if (!this.connection && !this.options.browserMode) {
      return this.queue.nowPlayingSong()
        ? Promise.reject(new Error("재생 기기가 연결되지 않았어요"))
        : Promise.resolve();
    }
    const version = {
      songId: this.queue.nowPlayingSong()?.id,
      attemptId: this.active?.attemptId,
      transition: this.transition,
    };
    return this.command(async () => {
      if (
        !version.songId ||
        this.abort.signal.aborted ||
        this.queue.nowPlayingSong()?.id !== version.songId ||
        this.transition !== version.transition ||
        (version.attemptId !== undefined &&
          this.active?.attemptId !== version.attemptId)
      )
        return;
      const active =
        this.active?.state === "reconciliation-required"
          ? await this.recover()
          : (this.active ?? (await this.recover()));
      if (
        !active ||
        !this.owner ||
        this.owner.released ||
        active.ownerEpoch !== this.owner.ownerEpoch
      ) {
        throw new Error("현재 재생을 확인한 뒤 다시 시도해 주세요");
      }
      await work(active);
    });
  }

  private reserve(
    song: Song,
    type: "play" | "restart" = "play",
    initialState: "playing" | "paused" = "playing",
    previousAttemptId?: string,
  ): PlaybackReservation {
    const owner = this.owner;
    if (!owner || owner.released)
      throw new Error("재생 기기를 먼저 선택해 주세요");
    const context: PlaybackContext = {
      commandId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      executorSessionId: owner.executorSessionId,
      target: owner.connection.target,
      connectionGeneration: owner.connection.connectionGeneration,
    };
    const now = this.now();
    const attempt: DurableAttempt = {
      attemptId: context.attemptId,
      songId: song.id,
      ownerEpoch: owner.ownerEpoch,
      context,
      reservedAt: now,
      startedAt: null,
      state: "starting",
      binding: null,
      sequence: -1,
      positionSec: null,
      durationSec: null,
    };
    const command: PlaybackCommand =
      type === "play"
        ? { type, trackRef: song.ref, initialState, context }
        : { type, initialState, context };
    return {
      attempt,
      command: {
        command,
        ownerEpoch: owner.ownerEpoch,
        state: "prepared",
        createdAt: now,
        updatedAt: now,
      },
      ...(previousAttemptId ? { previousAttemptId } : {}),
    };
  }

  private wake(): void {
    if (this.abort.signal.aborted) return;
    void this.command(async () => {
      if (
        this.abort.signal.aborted ||
        this.queue.nowPlayingSong() ||
        this.queue.hasProviderConflict() ||
        !this.owner ||
        this.owner.released
      )
        return;
      const selected = this.connection?.target ?? this.options.browserMode;
      if (
        !selected ||
        this.owner.connection.target.providerId !== selected.providerId ||
        this.owner.connection.target.modeId !== selected.modeId ||
        this.owner.connection.location !==
          (this.connection?.location ?? "browser") ||
        (this.connection &&
          this.owner.connection.connectionGeneration !==
            this.connection.connectionGeneration)
      ) {
        return;
      }
      // 연락 두절은 정지 증거가 아니며, 새 명령도 자동 전송하지 않아요.
      if (
        this.owner.connection.location === "browser" &&
        this.now() - this.owner.heartbeatAt >=
          (this.options.heartbeatTimeoutMs ?? 15000)
      )
        return;
      let reservation: PlaybackReservation | undefined;
      const song = await this.queue.takeAndStart((next) => {
        reservation = this.reserve(next);
        return reservation;
      });
      if (!song || !reservation || this.abort.signal.aborted) return;
      this.active = { ...reservation.attempt, song };
      this.transition += 1;
      try {
        await this.execute(this.active, reservation.command.command, true);
      } catch {
        // 신청을 보존하고 명시적 복구를 기다려요. play는 자동 재전송하지 않아요.
      }
    }).catch((error: unknown) => this.ended.reject(error));
  }

  private async execute(
    active: Attempt,
    input: PlaybackCommand,
    prepared = false,
    signal = this.abort.signal,
  ): Promise<void> {
    const command: PlaybackCommand = prepared
      ? input
      : {
          ...input,
          context: { ...active.context, commandId: crypto.randomUUID() },
        };
    if (!prepared) {
      const now = this.now();
      const stored: DurableCommand = {
        command,
        ownerEpoch: active.ownerEpoch,
        state: "prepared",
        createdAt: now,
        updatedAt: now,
      };
      const attempt = await this.repository.prepare(stored);
      this.active = active = { ...attempt, song: active.song };
    }
    if (command.type === "stop" && this.stopConfirmation) {
      this.stopConfirmation.commandId = command.context.commandId;
    }
    const fence = this.fence(active);
    try {
      await this.repository.setCommandState(
        fence,
        command.context.commandId,
        "sent",
        this.now(),
      );
    } catch (error) {
      await this.setStatus(active, "waiting");
      throw error;
    }
    emit("mutate");
    try {
      const outcome = await this.player.execute(command, signal);
      signal.throwIfAborted();
      if (!this.matchesContext(outcome.context, active))
        throw new Error("재생 명령 결과를 확인할 수 없어요");
      await this.receipt(fence, outcome);
      if (outcome.status !== "accepted") {
        await this.setStatus(
          this.active ?? active,
          outcome.status === "unknown" ? "reconciliation-required" : "waiting",
        );
        throw new Error(outcome.error.code);
      }
    } catch (error) {
      const commands = await this.repository.loadCommands(active.attemptId);
      const stored = commands.find(
        (entry) =>
          entry.command.context.commandId === command.context.commandId,
      );
      if (stored?.state === "sent" || stored?.state === "received") {
        await this.repository.setCommandState(
          fence,
          command.context.commandId,
          "unknown",
          this.now(),
        );
      }
      if (
        !this.abort.signal.aborted &&
        this.queue.snapshot().nowPlaying?.status !== "waiting"
      ) {
        await this.setStatus(this.active ?? active, "reconciliation-required");
      }
      throw error;
    }
  }

  private async stop(active: Attempt): Promise<void> {
    const completion = Promise.withResolvers<void>();
    const confirmation = {
      attemptId: active.attemptId,
      commandId: null as string | null,
      completion,
    };
    this.stopConfirmation = confirmation;
    const deadline = new AbortController();
    const expiration = Promise.withResolvers<never>();
    const expired = () => expiration.reject(deadline.signal.reason);
    deadline.signal.addEventListener("abort", expired, { once: true });
    const timeout = setTimeout(
      () => deadline.abort(new Error("정지 확인 시간이 초과됐어요")),
      this.options.stopConfirmationTimeoutMs ?? 12000,
    );
    const signal = AbortSignal.any([this.abort.signal, deadline.signal]);
    void completion.promise.catch(() => undefined);
    try {
      await Promise.race([
        Promise.all([
          this.execute(
            active,
            { type: "stop", context: active.context },
            false,
            signal,
          ),
          completion.promise,
        ]),
        expiration.promise,
      ]);
      this.abort.signal.throwIfAborted();
    } catch (error) {
      if (!this.abort.signal.aborted && deadline.signal.aborted) {
        await this.setStatus(this.active ?? active, "reconciliation-required");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      deadline.signal.removeEventListener("abort", expired);
      if (this.stopConfirmation === confirmation) this.stopConfirmation = null;
    }
  }

  private async finish(active: Attempt): Promise<void> {
    try {
      await this.queue.finishNowPlaying(
        "done",
        active.song.id,
        this.fence(active),
        this.now(),
      );
      this.active = null;
      this.owner = await this.repository.loadOwner();
      this.wake();
    } catch (error) {
      await this.setStatus(this.active ?? active, "waiting");
      throw error;
    }
  }

  private fence(active: DurableAttempt): PlaybackFence {
    return {
      attemptId: active.attemptId,
      ownerEpoch: active.ownerEpoch,
      executorSessionId: active.context.executorSessionId,
    };
  }

  private matchesIdentity(identity: OwnerIdentity, active: Attempt): boolean {
    return (
      !this.abort.signal.aborted &&
      this.owner !== null &&
      !this.owner.released &&
      identity.ownerEpoch === this.owner.ownerEpoch &&
      identity.executorSessionId === this.owner.executorSessionId &&
      active.ownerEpoch === identity.ownerEpoch &&
      active.context.executorSessionId === identity.executorSessionId
    );
  }

  private matchesContext(context: PlaybackContext, active: Attempt): boolean {
    return (
      context.commandId === active.context.commandId &&
      context.attemptId === active.attemptId &&
      context.executorSessionId === active.context.executorSessionId &&
      context.connectionGeneration === active.context.connectionGeneration &&
      context.target.providerId === active.context.target.providerId &&
      context.target.modeId === active.context.target.modeId &&
      context.target.targetId === active.context.target.targetId
    );
  }

  private matches(observation: PlaybackObservation, active: Attempt): boolean {
    return (
      observation.correlation !== null &&
      observation.target !== null &&
      observation.connectionGeneration !== null &&
      this.matchesContext(
        {
          ...observation.correlation,
          target: observation.target,
          connectionGeneration: observation.connectionGeneration,
        },
        active,
      )
    );
  }

  private async consume(): Promise<void> {
    try {
      for await (const observation of this.player.observe(this.abort.signal)) {
        if (this.abort.signal.aborted) break;
        const owner = this.owner;
        if (!owner) continue;
        void this.observation(owner, observation).catch((error: unknown) =>
          this.ended.reject(error),
        );
      }
      if (!this.abort.signal.aborted) {
        const current = this.queue.nowPlayingSong();
        if (current) this.queue.updatePlaybackStatus("waiting", current.id);
        this.stopConfirmation?.completion.reject(
          new Error("재생 관측이 끝났어요"),
        );
        this.ended.resolve();
      }
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.stopConfirmation?.completion.reject(error);
        this.ended.reject(error);
      }
    }
  }

  private async applyObservation(
    active: Attempt,
    observation: PlaybackObservation,
    reconciled = false,
  ): Promise<boolean> {
    if (
      !this.matches(observation, active) ||
      !(await this.authorize(this.fence(active), active.attemptId))
    )
      return false;
    const matchesTrack =
      observation.trackRef?.providerId === active.song.ref.providerId &&
      observation.trackRef.trackId === active.song.ref.trackId;
    const commands = await this.repository.loadCommands(active.attemptId);
    const command = commands.find(
      (entry) => entry.command.context.commandId === active.context.commandId,
    )?.command;
    const stopped = observation.state === "stopped" && command?.type === "stop";
    const state: DurableAttempt["state"] = stopped
      ? "waiting"
      : !matchesTrack || observation.state === "unknown"
        ? "reconciliation-required"
        : observation.state === "playing" || observation.state === "paused"
          ? observation.state
          : "waiting";
    const confirms =
      stopped ||
      (matchesTrack &&
        (((command?.type === "play" || command?.type === "restart") &&
          observation.state === command.initialState) ||
          (command?.type === "pause" && observation.state === "paused") ||
          (command?.type === "resume" && observation.state === "playing")));
    const stored = await this.repository.recordObservation(
      this.fence(active),
      observation,
      state,
      confirms,
      this.now(),
      reconciled,
    );
    if (!stored) return false;
    this.active = { ...stored, song: active.song };
    this.queue.applyPlayback(stored);
    emit("mutate");
    return true;
  }

  private async setStatus(
    active: Attempt,
    state: DurableAttempt["state"],
  ): Promise<void> {
    const stored = await this.repository.setAttemptState(
      this.fence(active),
      state,
    );
    this.active = { ...stored, song: active.song };
    this.queue.applyPlayback(stored);
  }

  private async recover(): Promise<Attempt | null> {
    const active = this.active;
    if (
      !active?.binding ||
      !this.owner ||
      this.owner.released ||
      !(await this.authorize(this.fence(active), active.attemptId))
    )
      return null;
    const result = await this.player.reconcile(
      active.binding,
      this.abort.signal,
    );
    if (!result.ok || result.value.status !== "match") return null;
    const observation = result.value.observation;
    if (
      !this.matches(observation, active) ||
      observation.trackRef?.providerId !== active.song.ref.providerId ||
      observation.trackRef.trackId !== active.song.ref.trackId ||
      (observation.state !== "playing" && observation.state !== "paused")
    )
      return null;
    return (await this.applyObservation(active, observation, true))
      ? this.active
      : null;
  }

  private async selectServerOwner(): Promise<void> {
    if (this.connection?.location !== "server") return;
    const owner = this.owner;
    if (
      owner &&
      !owner.released &&
      owner.stopConfirmed &&
      !this.queue.nowPlayingSong() &&
      owner.connection.location === "server" &&
      owner.connection.connectionGeneration !==
        this.connection.connectionGeneration
    ) {
      this.owner = await this.repository.release(owner);
    }
    if (!this.owner || this.owner.released) {
      this.owner = await this.repository.claim(
        {
          executorSessionId: this.executorSessionId,
          connection: this.connection,
        },
        this.now(),
      );
      this.options.onOwnerChange?.(this.owner);
    }
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
