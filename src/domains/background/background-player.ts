import type {
  BackgroundObservation,
  BackgroundPort,
} from "../../music/contracts";
import { emit } from "../shared/bus";
import type { BackgroundService } from "./background.service";

export type BackgroundNow = { title: string; artist: string | null };

export type BackgroundStatus = {
  available: boolean;
  active: boolean;
  waitingForTrackEnd: boolean;
  now: BackgroundNow | null;
  playlist: string | null;
  error: string | null;
};

type Scheduler = (callback: () => Promise<void>, delayMs: number) => () => void;

const IDLE_POLL_MS = 5000;
const HANDOFF_POLL_MS = 1000;
const FADE_MS = 2500;

// 신청곡이 없을 때 배경 음악을 맡고, 신청이 오면 정책에 맞춰 재생을 넘겨요.
// 신청곡 재생·소유권 판단은 PlaybackService가 하고 이 클래스는 배경만 다뤄요.
export class BackgroundPlayer {
  private readonly abort = new AbortController();
  private observed: BackgroundObservation | null = null;
  private pendingFrom: string | null | undefined;
  // 배경곡이 끝나 다음 신청곡에 자리를 내준 상태예요. 다음 배경곡을 또 기다리지 않아요.
  private released = false;
  // 직원이 멈춘 배경이나 시작에 실패한 목록을 다음 변경 알림마다 다시 틀지 않아요.
  private suppressed: string | null = null;
  // 대기열이 비어 배경을 맡은 뒤에만 배경곡 끝을 기다려요. 신청곡 사이 자동 추천곡은 기다리지 않아요.
  private engaged = false;
  private ready: (() => void) | null = null;
  private cancelPoll: (() => void) | null = null;
  private error: string | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly port: BackgroundPort | null,
    private readonly settings: Pick<BackgroundService, "read">,
    private readonly schedule: Scheduler = (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  ) {}

  bind(ready: () => void): void {
    this.ready = ready;
  }

  status(): BackgroundStatus {
    const observed = this.observed;
    const playing = this.engaged && observed?.state === "playing";
    return {
      available: this.port !== null,
      active: playing,
      waitingForTrackEnd: this.pendingFrom !== undefined,
      now:
        playing && observed?.title
          ? { title: observed.title, artist: observed.artist }
          : null,
      playlist: playing ? (observed?.playlist ?? null) : null,
      error: this.error,
    };
  }

  now(): BackgroundNow | null {
    return this.status().now;
  }

  listPlaylists(signal: AbortSignal) {
    if (!this.port)
      return Promise.resolve({
        ok: false as const,
        error: { code: "unsupported" as const },
      });
    return this.port.listPlaylists(signal);
  }

  // 대기열이 비었어요. 이미 음악이 흐르면(직원이 튼 음악 포함) 그대로 두고 배경으로 인정해요.
  idle(): Promise<void> {
    return this.run(async () => {
      this.pendingFrom = undefined;
      this.released = false;
      const settings = this.settings.read();
      if (!this.port || !settings.enabled || !settings.playlist) {
        await this.refresh();
        this.engaged = settings.enabled && this.observed?.state === "playing";
        return;
      }
      await this.refresh();
      if (this.observed?.state === "playing") {
        this.engaged = true;
        return;
      }
      if (this.suppressed === settings.playlist) return;
      await this.startPlaylist(settings.playlist);
      if (this.error) this.suppressed = settings.playlist;
      else this.engaged = true;
    });
  }

  // 직원이 "지금 배경으로"를 눌렀어요. 진행 중인 신청곡이 없을 때만 불려요.
  startNow(): Promise<void> {
    return this.run(async () => {
      const settings = this.settings.read();
      if (!this.port)
        throw new Error("이 재생 방식은 배경 음악을 지원하지 않아요");
      if (!settings.playlist)
        throw new Error("배경 음악으로 쓸 재생 목록을 먼저 골라주세요");
      this.pendingFrom = undefined;
      this.suppressed = null;
      await this.startPlaylist(settings.playlist);
      if (this.error) throw new Error(this.error);
      this.engaged = true;
    });
  }

  stopNow(): Promise<void> {
    return this.run(async () => {
      this.pendingFrom = undefined;
      this.engaged = false;
      this.suppressed = this.settings.read().playlist;
      await this.fade();
      await this.refresh();
    });
  }

  // 신청곡을 시작해도 되는지 알려줘요. false면 배경곡이 끝날 때 ready로 다시 알려줘요.
  beforeRequest(): Promise<boolean> {
    return this.run(async () => {
      if (!this.port) return true;
      this.suppressed = null;
      if (!this.engaged) {
        this.pendingFrom = undefined;
        this.released = false;
        return true;
      }
      if (this.released) {
        this.released = false;
        this.engaged = false;
        await this.fade();
        return true;
      }
      await this.refresh();
      if (this.observed?.state !== "playing") {
        this.pendingFrom = undefined;
        this.engaged = false;
        return true;
      }
      if (this.settings.read().handoff === "immediate") {
        this.pendingFrom = undefined;
        this.engaged = false;
        await this.fade();
        return true;
      }
      if (this.pendingFrom === undefined) {
        this.pendingFrom = this.observed.trackKey;
        emit("mutate");
      }
      return false;
    });
  }

  dispose(): void {
    this.abort.abort();
    this.cancelPoll?.();
    this.cancelPoll = null;
    this.ready = null;
  }

  private async startPlaylist(playlist: string): Promise<void> {
    if (!this.port) return;
    const result = await this.port.start(playlist, this.abort.signal);
    this.error = result.ok
      ? null
      : `배경 음악을 시작하지 못했어요 (${result.error.code}). 재생 목록 이름을 확인해주세요.`;
    await this.refresh();
  }

  private async fade(): Promise<void> {
    if (!this.port) return;
    const result = await this.port.fadeOut(FADE_MS, this.abort.signal);
    if (!result.ok) this.error = "배경 음악을 멈추지 못했어요";
  }

  private async refresh(): Promise<void> {
    if (!this.port || this.abort.signal.aborted) return;
    const result = await this.port.observe(this.abort.signal);
    const next = result.ok ? result.value : null;
    const before = this.status();
    this.observed = next;
    const after = this.status();
    if (JSON.stringify(before) !== JSON.stringify(after)) emit("mutate");
    this.arm();
  }

  private arm(): void {
    this.cancelPoll?.();
    this.cancelPoll = null;
    if (!this.port || this.abort.signal.aborted) return;
    const waiting = this.pendingFrom !== undefined;
    if (!waiting && !(this.engaged && this.observed?.state === "playing"))
      return;
    this.cancelPoll = this.schedule(
      () => this.run(() => this.tick()).catch(() => undefined),
      waiting ? HANDOFF_POLL_MS : IDLE_POLL_MS,
    );
  }

  private async tick(): Promise<void> {
    this.cancelPoll = null;
    await this.refresh();
    if (this.pendingFrom === undefined) return;
    const observed = this.observed;
    const nearEnd =
      observed?.positionSec != null &&
      observed.durationSec != null &&
      observed.durationSec > 0 &&
      observed.positionSec >= observed.durationSec - 1.5;
    // 다음 배경곡으로 넘어갔거나, 곧 끝나거나, 멈췄으면 신청곡 차례예요.
    if (
      observed?.state !== "playing" ||
      observed.trackKey !== this.pendingFrom ||
      nearEnd
    ) {
      this.pendingFrom = undefined;
      this.released = true;
      this.arm();
      this.ready?.();
    }
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
