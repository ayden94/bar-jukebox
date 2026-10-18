import type {
  BrowserMusicProvider,
  MusicResult,
  ProviderDescriptor,
  ProviderIdentity,
} from "../../music/contracts";
import type {
  BrowserMusicOptions,
  SelectedBrowserFactory,
} from "./music-registry";
import type { PlaybackFetcher } from "./playback-channel";
import { BrowserPlaybackExecutor } from "./playback-runtime";

const requiredPlaybackCapabilities = [
  "canPlayExactTrack",
  "canPause",
  "canResume",
  "canStop",
  "canRestart",
  "canObserveEnd",
] as const;

export type BrowserHostPhase =
  | "disconnected"
  | "loading"
  | "authorizing"
  | "connecting"
  | "claiming"
  | "connected"
  | "disconnecting"
  | "unknown"
  | "unavailable";

export type BrowserHostState = {
  readonly phase: BrowserHostPhase;
  readonly error: string;
};

type HostOptions = BrowserMusicOptions & {
  readonly token: string;
  readonly fetcher?: PlaybackFetcher;
  readonly loadFactory: (
    selected: ProviderIdentity,
    signal: AbortSignal,
  ) => Promise<MusicResult<SelectedBrowserFactory>>;
};

function failure(result: MusicResult<unknown>): void {
  if (!result.ok) {
    throw new Error(
      result.error.code === "unsupported"
        ? "선택한 브라우저 재생기는 아직 제공하지 않아요."
        : "음악 계정과 재생 기기를 연결하지 못했어요. 연결 상태를 확인해주세요.",
    );
  }
}

// 문서 하나가 한 수명을 소유해요. 라우트·React 렌더는 자원을 생성하지 않아요.
export class BrowserMusicLifecycle {
  private state: BrowserHostState = { phase: "disconnected", error: "" };
  private readonly listeners = new Set<() => void>();
  private selected: ProviderIdentity | null = null;
  private provider: BrowserMusicProvider | null = null;
  private executor: BrowserPlaybackExecutor | null = null;
  private connecting: Promise<void> | null = null;
  private disconnecting: Promise<void> | null = null;
  private abandoning: Promise<void> | null = null;
  private operation: AbortController | null = null;
  private closed = false;

  constructor(private readonly options: HostOptions) {}

  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(phase: BrowserHostPhase, error = "") {
    this.state = { phase, error };
    for (const listener of this.listeners) listener();
  }

  connect(
    selected: ProviderIdentity,
    descriptor: ProviderDescriptor,
  ): Promise<void> {
    if (this.closed || this.connecting || this.disconnecting || this.executor)
      return this.connecting ?? Promise.resolve();
    if (
      this.selected &&
      (this.selected.providerId !== selected.providerId ||
        this.selected.modeId !== selected.modeId)
    ) {
      this.update(
        "unavailable",
        "서버 실행 설정이 바뀌었어요. 페이지를 새로 열어주세요.",
      );
      return Promise.resolve();
    }
    this.selected ??= { ...selected };
    const controller = new AbortController();
    this.operation = controller;
    this.connecting = this.start(
      selected,
      descriptor,
      controller.signal,
    ).finally(() => {
      this.connecting = null;
      if (this.operation === controller) this.operation = null;
    });
    return this.connecting;
  }

  private async start(
    selected: ProviderIdentity,
    descriptor: ProviderDescriptor,
    signal: AbortSignal,
  ) {
    let claiming = false;
    try {
      this.update("loading");
      const loaded = await this.options.loadFactory(selected, signal);
      signal.throwIfAborted();
      failure(loaded);
      if (!loaded.ok) return;
      const created = await loaded.value({ api: this.options.api }, signal);
      if (created.ok) this.provider = created.value;
      signal.throwIfAborted();
      failure(created);
      if (!created.ok) return;
      const provider = created.value;
      const mode = descriptor.modes.find(
        (mode) => mode.modeId === selected.modeId,
      );
      if (
        descriptor.providerId !== selected.providerId ||
        provider.identity.providerId !== selected.providerId ||
        provider.identity.modeId !== selected.modeId ||
        mode?.location !== "browser" ||
        requiredPlaybackCapabilities.some((key) => !mode.capabilities[key])
      )
        throw new Error("선택한 음악 서비스와 브라우저 재생기가 달라요.");
      this.update("authorizing");
      const auth = await provider.auth.connect(signal);
      signal.throwIfAborted();
      failure(auth);
      if (!auth.ok || auth.value.status !== "authorized")
        throw new Error("음악 계정의 재생 권한을 먼저 확인해주세요.");
      this.update("connecting");
      const targets = await provider.runtime.connection.listTargets(signal);
      signal.throwIfAborted();
      failure(targets);
      if (!targets.ok) return;
      const candidates = targets.value.filter(
        (target) =>
          target.location === "browser" &&
          target.ref.providerId === selected.providerId &&
          target.ref.modeId === selected.modeId,
      );
      if (candidates.length !== 1 || !candidates[0])
        throw new Error(
          "이 브라우저에서 사용할 재생 기기 하나를 연결해주세요.",
        );
      const connected = await provider.runtime.connection.connect(
        candidates[0].ref,
        signal,
      );
      signal.throwIfAborted();
      failure(connected);
      if (!connected.ok) return;
      const connection = connected.value;
      if (
        connection.location !== "browser" ||
        connection.target.providerId !== selected.providerId ||
        connection.target.modeId !== selected.modeId ||
        connection.target.targetId !== candidates[0].ref.targetId ||
        !connection.connectionGeneration ||
        requiredPlaybackCapabilities.some(
          (key) => !connection.capabilities[key],
        )
      )
        throw new Error(
          "정확한 곡 재생과 정지·종료 확인 기능을 사용할 수 없어요.",
        );
      this.update("claiming");
      claiming = true;
      const executor = new BrowserPlaybackExecutor({
        token: this.options.token,
        fetcher: this.options.fetcher,
        playback: provider.runtime.playback,
        connection,
        onDisconnected: () => {
          this.update(
            "unknown",
            "재생 연결이 끊겼어요. 실제 오디오가 멈췄는지 확인해주세요.",
          );
        },
      });
      this.executor = executor;
      await executor.start();
      signal.throwIfAborted();
      if (this.state.phase === "claiming") this.update("connected");
    } catch (error) {
      await this.disposeResources();
      this.update(
        claiming ? "unknown" : "unavailable",
        signal.aborted
          ? "연결을 취소했어요. 재생 권한은 서버 상태에서 확인해주세요."
          : claiming
            ? "다른 관리자 문서가 연결되어 있거나 재생 권한을 확인하지 못했어요. 재생 권한 확인으로 상태를 확인해주세요."
            : error instanceof Error
              ? error.message
              : "브라우저 연결을 확인하지 못했어요.",
      );
    }
  }

  disconnect(): Promise<void> {
    if (this.disconnecting) return this.disconnecting;
    this.operation?.abort();
    this.disconnecting = this.stop().finally(() => {
      this.disconnecting = null;
    });
    return this.disconnecting;
  }

  private async stop() {
    await this.connecting;
    const executor = this.executor;
    const wasUnknown = this.state.phase === "unknown";
    this.update("disconnecting");
    try {
      if (executor) await executor.release();
      await this.disposeResources();
      this.update(wasUnknown && !executor ? "unknown" : "disconnected");
    } catch {
      await this.disposeResources();
      this.update(
        "unknown",
        "정지와 권한 해제를 확인하지 못했어요. 실제 오디오를 멈춘 뒤 정지를 확인해주세요.",
      );
    }
  }

  private async disposeResources() {
    const executor = this.executor;
    const provider = this.provider;
    this.executor = null;
    this.provider = null;
    try {
      await executor?.dispose();
    } finally {
      await provider?.dispose();
    }
  }

  // 페이지 종료는 async release 완료를 보장하지 않으므로 해제했다고 표시하지 않아요.
  abandon(): Promise<void> {
    if (this.abandoning) return this.abandoning;
    this.closed = true;
    this.operation?.abort();
    this.abandoning = (async () => {
      await this.connecting;
      await this.disposeResources();
      this.update(
        "unknown",
        "페이지 연결이 끝났어요. 정지 확인 후 새로 연결해주세요.",
      );
    })();
    return this.abandoning;
  }

  async resume() {
    await this.abandoning;
    this.abandoning = null;
    this.closed = false;
  }

  async close() {
    this.closed = true;
    await this.disconnect();
  }
}
