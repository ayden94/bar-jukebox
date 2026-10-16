import type {
  CommandOutcome,
  MusicResult,
  NativeBinding,
  PlaybackCommand,
  PlaybackObservation,
  PlaybackPort,
  Reconciliation,
} from "../../music/contracts";
import type { OwnerIdentity, PlaybackOwner } from "./protocol";

export type BrowserPlaybackMessage =
  | { type: "command"; command: PlaybackCommand }
  | {
      type: "reconcile";
      requestId: string;
      owner: OwnerIdentity;
      binding: NativeBinding;
    };

// 저장·owner 판정은 서비스가 맡고 이 포트는 인증된 실행기에 전달만 해요.
export class BrowserPlaybackBridge implements PlaybackPort {
  private owner: PlaybackOwner | null = null;
  private disposed = false;
  private current: PlaybackObservation = {
    state: "unavailable",
    trackRef: null,
    target: null,
    connectionGeneration: null,
    correlation: null,
    binding: null,
    sequence: 0,
    positionSec: null,
    durationSec: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly observers = new Set<{
    push(value: PlaybackObservation): void;
    close(): void;
  }>();
  private readonly commands = new Map<
    string,
    {
      command: PlaybackCommand;
      finish(outcome: CommandOutcome): void;
    }
  >();
  private readonly reconciliations = new Map<
    string,
    {
      message: Extract<BrowserPlaybackMessage, { type: "reconcile" }>;
      finish(result: MusicResult<Reconciliation>): void;
    }
  >();

  constructor(private readonly receiptTimeoutMs = 12000) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  messages(): BrowserPlaybackMessage[] {
    return [
      ...[...this.commands.values()].map(({ command }) => ({
        type: "command" as const,
        command,
      })),
      ...[...this.reconciliations.values()].map(({ message }) => message),
    ];
  }

  bindOwner(owner: PlaybackOwner | null): void {
    if (
      this.owner?.ownerEpoch === owner?.ownerEpoch &&
      this.owner?.executorSessionId === owner?.executorSessionId &&
      this.owner?.released === owner?.released
    ) {
      this.owner = owner;
      return;
    }
    this.owner = owner;
    for (const pending of [...this.commands.values()]) {
      pending.finish({
        status: "unknown",
        context: pending.command.context,
        error: { code: "unknown-outcome" },
      });
    }
    for (const pending of [...this.reconciliations.values()]) {
      pending.finish({ ok: true, value: { status: "unknown" } });
    }
    this.current = {
      ...this.current,
      state: "unavailable",
      endReason: undefined,
      trackRef: null,
      binding: null,
      correlation: null,
      target: owner?.connection.target ?? null,
      connectionGeneration: owner?.connection.connectionGeneration ?? null,
      sequence: 0,
    };
    for (const observer of this.observers) observer.push(this.current);
    this.notify();
  }

  private owns(identity: OwnerIdentity): boolean {
    return (
      !this.disposed &&
      this.owner !== null &&
      !this.owner.released &&
      this.owner.ownerEpoch === identity.ownerEpoch &&
      this.owner.executorSessionId === identity.executorSessionId
    );
  }

  private matchesConnection(
    value: Pick<PlaybackObservation, "target" | "connectionGeneration">,
  ): boolean {
    const connection = this.owner?.connection;
    return (
      connection !== undefined &&
      value.connectionGeneration === connection.connectionGeneration &&
      value.target?.providerId === connection.target.providerId &&
      value.target.modeId === connection.target.modeId &&
      value.target.targetId === connection.target.targetId
    );
  }

  execute(
    command: PlaybackCommand,
    signal: AbortSignal,
  ): Promise<CommandOutcome> {
    if (
      signal.aborted ||
      !this.owner ||
      !this.owns(this.owner) ||
      command.context.executorSessionId !== this.owner.executorSessionId ||
      !this.matchesConnection(command.context)
    ) {
      return Promise.resolve({
        status: "rejected",
        context: command.context,
        error: { code: "disconnected" },
      });
    }
    if (this.commands.has(command.context.commandId)) {
      return Promise.resolve({
        status: "unknown",
        context: command.context,
        error: { code: "unknown-outcome" },
      });
    }
    return new Promise((resolve) => {
      const unknown = () =>
        finish({
          status: "unknown",
          context: command.context,
          error: { code: "unknown-outcome" },
        });
      const timeout = setTimeout(unknown, this.receiptTimeoutMs);
      const finish = (outcome: CommandOutcome) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", unknown);
        this.commands.delete(command.context.commandId);
        resolve(outcome);
        this.notify();
      };
      this.commands.set(command.context.commandId, { command, finish });
      signal.addEventListener("abort", unknown, { once: true });
      this.notify();
    });
  }

  acceptReceipt(identity: OwnerIdentity, outcome: CommandOutcome): boolean {
    if (!this.owns(identity)) return false;
    const pending = this.commands.get(outcome.context.commandId);
    if (
      !pending ||
      !this.matchesConnection(outcome.context) ||
      outcome.context.attemptId !== pending.command.context.attemptId ||
      outcome.context.executorSessionId !== identity.executorSessionId
    )
      return false;
    pending.finish(outcome);
    return true;
  }

  acceptObservation(
    identity: OwnerIdentity,
    observation: PlaybackObservation,
  ): boolean {
    if (
      !this.owns(identity) ||
      !this.matchesConnection(observation) ||
      (observation.correlation !== null &&
        observation.correlation.executorSessionId !==
          identity.executorSessionId) ||
      observation.sequence <= this.current.sequence
    )
      return false;
    this.current = observation;
    for (const observer of this.observers) observer.push(observation);
    return true;
  }

  reconcile(
    binding: NativeBinding,
    signal: AbortSignal,
  ): Promise<MusicResult<Reconciliation>> {
    if (signal.aborted || !this.owner || !this.owns(this.owner)) {
      return Promise.resolve({ ok: false, error: { code: "disconnected" } });
    }
    const requestId = crypto.randomUUID();
    const owner = {
      ownerEpoch: this.owner.ownerEpoch,
      executorSessionId: this.owner.executorSessionId,
    };
    return new Promise((resolve) => {
      const unknown = () => finish({ ok: true, value: { status: "unknown" } });
      const timeout = setTimeout(unknown, this.receiptTimeoutMs);
      const finish = (result: MusicResult<Reconciliation>) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", unknown);
        this.reconciliations.delete(requestId);
        resolve(result);
        this.notify();
      };
      this.reconciliations.set(requestId, {
        message: { type: "reconcile", requestId, owner, binding },
        finish,
      });
      signal.addEventListener("abort", unknown, { once: true });
      this.notify();
    });
  }

  completeReconcile(
    identity: OwnerIdentity,
    requestId: string,
    result: MusicResult<Reconciliation>,
  ): boolean {
    if (!this.owns(identity)) return false;
    const pending = this.reconciliations.get(requestId);
    if (!pending) return false;
    if (result.ok && result.value.status !== "unknown") {
      if (!this.matchesConnection(result.value.observation)) return false;
    }
    pending.finish(result);
    return true;
  }

  observe(
    signal: AbortSignal,
  ): AsyncIterableIterator<PlaybackObservation, undefined> {
    let closed = false;
    const values: PlaybackObservation[] = [this.current];
    const readers: Array<
      (value: IteratorResult<PlaybackObservation, undefined>) => void
    > = [];
    const observer = {
      push: (value: PlaybackObservation) => {
        if (closed) return;
        const reader = readers.shift();
        if (reader) reader({ done: false, value });
        else values.push(value);
      },
      close: () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener("abort", observer.close);
        this.observers.delete(observer);
        values.length = 0;
        for (const reader of readers.splice(0))
          reader({ done: true, value: undefined });
      },
    };
    this.observers.add(observer);
    signal.addEventListener("abort", observer.close, { once: true });
    if (signal.aborted || this.disposed) observer.close();
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => {
        if (closed) return Promise.resolve({ done: true, value: undefined });
        const value = values.shift();
        return value
          ? Promise.resolve({ done: false, value })
          : new Promise((resolve) => readers.push(resolve));
      },
      return: async () => {
        observer.close();
        return { done: true, value: undefined };
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.bindOwner(null);
    for (const observer of [...this.observers]) observer.close();
    this.listeners.clear();
  }
}
