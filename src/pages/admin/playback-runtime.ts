import type { BrowserCatalogRequest } from "../../domains/music/browser-catalog-protocol";
import type { BrowserPlaybackMessage } from "../../domains/playback/browser-playback-bridge";
import type {
  PlaybackOwner,
  PlaybackSnapshot,
} from "../../domains/playback/protocol";
import type {
  CommandOutcome,
  ConnectedTarget,
  PlaybackCommand,
  PlaybackContext,
  PlaybackObservation,
  PlaybackPort,
} from "../../music/contracts";
import { type PlaybackFetcher, playbackEvents } from "./playback-channel";

export type BrowserPlaybackSnapshot = PlaybackSnapshot & {
  messages: BrowserPlaybackMessage[];
  catalogRequests: BrowserCatalogRequest[];
};

type RuntimeOptions = {
  token: string;
  playback: PlaybackPort;
  connection: ConnectedTarget;
  fetcher?: PlaybackFetcher;
  onSnapshot?: (snapshot: BrowserPlaybackSnapshot) => void;
  onCatalogSnapshot?: (snapshot: BrowserPlaybackSnapshot) => void;
  onCatalogDisconnect?: () => void;
  onDisconnected?: (error: unknown) => void;
};

// React 라우트가 아니라 관리자 문서가 소유해요. SDK는 공급자 포트 안에 있어요.
export class BrowserPlaybackExecutor {
  readonly executorSessionId = crypto.randomUUID();
  private readonly abort = new AbortController();
  private readonly fetcher: PlaybackFetcher;
  private owner: PlaybackOwner | null = null;
  private accepting = false;
  private releasing = false;
  private released = false;
  private disposed: Promise<void> | null = null;
  private latestContext: PlaybackContext | null = null;
  private commands = Promise.resolve();
  private reports = Promise.resolve();
  private channel: Promise<void> | null = null;
  private observations: Promise<void> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly seen = new Set<string>();

  constructor(private readonly options: RuntimeOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(`/api/admin/playback/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": this.options.token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok)
      throw new Error(`재생 실행기 요청 실패 (${response.status})`);
    return response.json();
  }

  async start(): Promise<void> {
    if (this.owner || this.abort.signal.aborted)
      throw new Error("실행기를 다시 선택할 수 없어요");
    const result = await this.post("owner", {
      executorSessionId: this.executorSessionId,
      connection: this.options.connection,
    });
    if (!result || typeof result !== "object" || !("owner" in result)) {
      throw new Error("재생 owner 응답이 올바르지 않아요");
    }
    const owner = result.owner as PlaybackOwner;
    if (
      !owner ||
      !Number.isSafeInteger(owner.ownerEpoch) ||
      owner.ownerEpoch < 1 ||
      owner.executorSessionId !== this.executorSessionId ||
      owner.connection?.connectionGeneration !==
        this.options.connection.connectionGeneration ||
      owner.released
    )
      throw new Error("선택한 재생 실행기와 응답이 달라요");
    this.owner = owner;
    this.accepting = true;
    this.observations = this.observe();
    this.channel = this.listen();
    this.heartbeat = setInterval(() => {
      void this.post("heartbeat", this.identity()).catch((error: unknown) =>
        this.disconnect(error),
      );
    }, 5000);
  }

  private identity() {
    if (!this.owner) throw new Error("재생 실행기를 먼저 선택해주세요");
    return {
      ownerEpoch: this.owner.ownerEpoch,
      executorSessionId: this.executorSessionId,
    };
  }

  private async listen(): Promise<void> {
    try {
      for await (const event of playbackEvents(
        this.options.token,
        this.executorSessionId,
        this.abort.signal,
        this.fetcher,
      )) {
        if (event.event !== "snapshot") continue;
        const snapshot = event.data as BrowserPlaybackSnapshot;
        if (
          !snapshot ||
          typeof snapshot !== "object" ||
          !Array.isArray(snapshot.messages)
        ) {
          throw new Error("재생 스냅샷 형식이 올바르지 않아요");
        }
        this.options.onSnapshot?.(snapshot);
        this.options.onCatalogSnapshot?.(snapshot);
        if (
          this.releasing &&
          snapshot.owner?.ownerEpoch === this.owner?.ownerEpoch &&
          snapshot.owner?.executorSessionId === this.executorSessionId &&
          snapshot.owner.released
        ) {
          // release 응답보다 SSE가 먼저 도착해도 요청을 취소하지 않아요.
          this.accepting = false;
          continue;
        }
        if (
          snapshot.owner?.ownerEpoch !== this.owner?.ownerEpoch ||
          snapshot.owner?.executorSessionId !== this.executorSessionId ||
          snapshot.owner.released
        )
          throw new Error("재생 권한이 변경됐어요");
        for (const message of snapshot.messages) {
          if (message.type === "command") {
            if (!this.validCommand(message.command))
              throw new Error("재생 명령 형식이 올바르지 않아요");
            if (this.seen.has(message.command.context.commandId)) continue;
            this.seen.add(message.command.context.commandId);
          }
          this.commands = this.commands.then(() => this.apply(message));
          void this.commands.catch((error: unknown) => this.disconnect(error));
        }
      }
      if (!this.abort.signal.aborted)
        this.disconnect(new Error("재생 연결이 닫혔어요"));
    } catch (error) {
      if (!this.abort.signal.aborted) this.disconnect(error);
    }
  }

  private matches(context: PlaybackContext): boolean {
    const connection = this.options.connection;
    return (
      context.executorSessionId === this.executorSessionId &&
      context.connectionGeneration === connection.connectionGeneration &&
      context.target.providerId === connection.target.providerId &&
      context.target.modeId === connection.target.modeId &&
      context.target.targetId === connection.target.targetId
    );
  }

  private validCommand(value: unknown): value is PlaybackCommand {
    if (!value || typeof value !== "object") return false;
    const command = value as Record<string, unknown>;
    if (!command.context || typeof command.context !== "object") return false;
    const context = command.context as Record<string, unknown>;
    if (
      ![
        "commandId",
        "attemptId",
        "executorSessionId",
        "connectionGeneration",
      ].every(
        (key) => typeof context[key] === "string" && context[key] !== "",
      ) ||
      !context.target ||
      typeof context.target !== "object"
    )
      return false;
    const target = context.target as Record<string, unknown>;
    if (
      !["providerId", "modeId", "targetId"].every(
        (key) => typeof target[key] === "string" && target[key] !== "",
      )
    )
      return false;
    if (command.type === "play") {
      if (!command.trackRef || typeof command.trackRef !== "object")
        return false;
      const ref = command.trackRef as Record<string, unknown>;
      return (
        ref.providerId === this.options.connection.target.providerId &&
        typeof ref.trackId === "string" &&
        ref.trackId !== "" &&
        (command.initialState === "playing" ||
          command.initialState === "paused")
      );
    }
    if (command.type === "restart")
      return (
        command.initialState === "playing" || command.initialState === "paused"
      );
    if (command.type === "seek")
      return (
        typeof command.positionSec === "number" &&
        Number.isFinite(command.positionSec) &&
        command.positionSec >= 0
      );
    return (
      command.type === "pause" ||
      command.type === "resume" ||
      command.type === "stop"
    );
  }

  private async apply(message: BrowserPlaybackMessage): Promise<void> {
    if (!this.accepting || this.abort.signal.aborted) return;
    if (message.type === "reconcile") {
      if (
        message.owner.ownerEpoch !== this.owner?.ownerEpoch ||
        message.owner.executorSessionId !== this.executorSessionId
      )
        return;
      const result = await this.options.playback.reconcile(
        message.binding,
        this.abort.signal,
      );
      await this.post("reconciliation", {
        ...this.identity(),
        requestId: message.requestId,
        result,
      });
      return;
    }
    if (message.type !== "command" || !this.matches(message.command.context))
      return;
    const command = message.command;
    this.latestContext = command.context;
    let outcome: CommandOutcome;
    try {
      outcome = await this.options.playback.execute(command, this.abort.signal);
    } catch {
      outcome = {
        status: "unknown",
        context: command.context,
        error: { code: "unknown-outcome" },
      };
    }
    if (!this.abort.signal.aborted) {
      await this.post("receipt", { ...this.identity(), outcome });
    }
  }

  private async observe(): Promise<void> {
    try {
      for await (const observation of this.options.playback.observe(
        this.abort.signal,
      )) {
        if (
          !this.accepting ||
          !observation.correlation ||
          !observation.target ||
          !observation.connectionGeneration ||
          !this.matches({
            ...observation.correlation,
            target: observation.target,
            connectionGeneration: observation.connectionGeneration,
          })
        )
          continue;
        this.report(observation);
      }
    } catch (error) {
      if (!this.abort.signal.aborted) this.disconnect(error);
    }
  }

  private report(observation: PlaybackObservation): void {
    const commands = this.commands;
    this.reports = this.reports.then(async () => {
      await commands;
      if (!this.accepting || this.abort.signal.aborted) return;
      await this.post("observation", { ...this.identity(), observation });
    });
    void this.reports.catch((error: unknown) => this.disconnect(error));
  }

  private disconnect(error: unknown): void {
    if (!this.accepting) return;
    this.accepting = false;
    this.options.onDisconnected?.(error);
    void this.dispose();
  }

  async release(): Promise<void> {
    if (this.releasing || !this.accepting || this.abort.signal.aborted)
      throw new Error(
        "연결이 끊겨 정지를 확인할 수 없어요. 실제 정지 후 확인해주세요.",
      );
    this.releasing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    try {
      // 서버가 stop 명령의 receipt와 관측을 받는 동안 채널을 유지해요.
      const result = await this.post("release", this.identity());
      if (
        !result ||
        typeof result !== "object" ||
        !("ok" in result) ||
        result.ok !== true
      )
        throw new Error("재생 기기 해제를 확인하지 못했어요.");
      this.released = true;
    } finally {
      await this.dispose();
    }
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.disposed;
    this.accepting = false;
    this.options.onCatalogDisconnect?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.abort.abort();
    this.disposed = (async () => {
      // 네트워크 상실은 정지 증거가 아니에요. 가능한 로컬 정리만 시도해요.
      if (this.latestContext && !this.released) {
        try {
          await this.options.playback.execute(
            {
              type: "stop",
              context: {
                ...this.latestContext,
                commandId: crypto.randomUUID(),
              },
            },
            AbortSignal.timeout(5000),
          );
        } catch {
          // 서버 owner를 해제하지 않으므로 다른 기기가 자동 재생하지 않아요.
        }
      }
      await this.options.playback.dispose();
      await Promise.allSettled([
        this.channel,
        this.observations,
        this.commands,
        this.reports,
      ]);
    })();
    return this.disposed;
  }
}
