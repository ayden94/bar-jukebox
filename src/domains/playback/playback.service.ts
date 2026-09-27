import type { QueueService } from "../queue/queue.service";
import { musicDriver, type PlaybackDriver } from "./music.driver";

export type { PlaybackDriver } from "./music.driver";

type PlaybackVersion = { readonly songId: string; readonly revision: number };

export class PlaybackService {
  private commandChain: Promise<void> = Promise.resolve();
  private revision = 0;
  private transition = 0;
  // 제어 실패 후에는 호출자가 재시도할 때까지 자동 완료를 막아요.
  private suspended = false;

  constructor(
    private readonly queue: QueueService,
    private readonly player: PlaybackDriver = musicDriver,
  ) {}

  skip(): Promise<void> {
    return this.control(async (version) => {
      await this.player.stop();
      // 다음 곡 직후 이전을 누르면 방금 건너뛴 신청곡으로 돌아가요.
      await this.queue.finishNowPlaying("done", version.songId);
    }, true);
  }

  pause(): Promise<void> {
    return this.control(async (version) => {
      await this.player.pause();
      this.queue.updatePlaybackStatus("paused", version.songId);
    });
  }

  resume(): Promise<void> {
    return this.control(async (version) => {
      await this.player.resume();
      this.queue.updatePlaybackStatus("playing", version.songId);
    });
  }

  previous(): Promise<void> {
    return this.control(async (version) => {
      const current = this.queue.snapshot().nowPlaying;
      if (!current) return;
      // 반올림된 공개 진행률 대신 Music.app의 실제 초 단위를 사용해요.
      const position = await this.player.position();
      const previous = await this.queue.previous(
        version.songId,
        (position ?? current.positionSec) >= 3,
      );
      if (!previous) return;
      if (previous.id === version.songId) {
        await this.player.restart();
      } else {
        await this.player.play(previous);
        if (current.status === "paused") await this.player.pause();
      }
    }, true);
  }

  private version(): PlaybackVersion | null {
    const song = this.queue.nowPlayingSong();
    return song ? { songId: song.id, revision: this.revision } : null;
  }

  private isCurrent(version: PlaybackVersion): boolean {
    return (
      this.queue.nowPlayingSong()?.id === version.songId &&
      this.revision === version.revision
    );
  }

  private control(
    work: (version: PlaybackVersion) => Promise<void>,
    changesTrack = false,
  ): Promise<void> {
    // 호출 시 대상을 고정해 준비/완료 중 들어온 명령이 다음 곡에 적용되지 않아요.
    const version = this.version();
    const transition = this.transition;
    return this.command(async () => {
      if (
        !version ||
        this.queue.nowPlayingSong()?.id !== version.songId ||
        transition !== this.transition
      )
        return;
      this.revision += 1;
      if (changesTrack) this.transition += 1;
      this.suspended = true;
      await work(version);
      this.suspended = false;
    });
  }

  private command<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(task);
    this.commandChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async start(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const active = await this.command(async () => {
        if (this.suspended) return null;
        // 복원되거나 이전 버튼으로 바뀐 곡을 다시 시작하지 않아요.
        const current = this.version();
        if (current) return { version: current, fresh: false };
        const next = await this.queue.takeAndStart();
        if (!next) return null;
        this.revision += 1;
        this.transition += 1;
        const version = { songId: next.id, revision: this.revision };
        try {
          await this.player.play(next);
        } catch (error) {
          await this.queue.finishNowPlaying("failed", next.id);
          console.error("playSong failed:", error);
          return null;
        }
        return { version, fresh: true };
      });
      if (!active) {
        if (!signal?.aborted) await this.player.sleep(1000);
        continue;
      }
      if (active.fresh && !(await this.waitForStart(active.version, signal))) {
        await this.command(async () => {
          if (this.isCurrent(active.version) && !signal?.aborted) {
            await this.queue.finishNowPlaying("failed", active.version.songId);
          }
        });
        continue;
      }
      await this.waitForTrackEnd(active.version, signal);
    }
  }

  private async waitForStart(
    version: PlaybackVersion,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = this.player.now() + 12000;
    while (
      this.isCurrent(version) &&
      !signal?.aborted &&
      this.player.now() < deadline
    ) {
      const state = await this.player.playerState();
      if (state !== "stopped") return this.isCurrent(version);
      if (!this.isCurrent(version)) return false;
      await this.player.sleep(400);
    }
    return false;
  }

  // 읽기는 명령을 막지 않고 반영·정지·완료만 같은 직렬화 경계에서 실행해요.
  private async waitForTrackEnd(
    version: PlaybackVersion,
    signal?: AbortSignal,
  ): Promise<void> {
    const expectedTrackId = await this.player.currentTrackId();
    const duration = await this.player.duration();
    while (this.isCurrent(version) && !signal?.aborted) {
      const position = await this.player.position();
      const state = await this.player.playerState();
      const trackId = await this.player.currentTrackId();
      await this.command(async () => {
        // 같은 신청곡을 다시 시작해도 예전 관측 결과는 무효예요.
        if (!this.isCurrent(version) || this.suspended) return;
        if (position !== null)
          this.queue.updateProgress(position, duration, version.songId);
        if (state === "paused") {
          this.queue.updatePlaybackStatus("paused", version.songId);
          return;
        }
        const changed =
          expectedTrackId !== null &&
          trackId !== null &&
          trackId !== expectedTrackId;
        const atEnd =
          duration !== null && position !== null && position >= duration - 0.15;
        if (state === "stopped" || changed || atEnd) {
          if (state !== "stopped") await this.player.stop();
          await this.queue.finishNowPlaying("done", version.songId);
          return;
        }
        this.queue.updatePlaybackStatus("playing", version.songId);
      });
      if (!this.isCurrent(version) || signal?.aborted) return;
      // 벽시계 마감은 두지 않아요. 일시정지·재시작은 실제 위치로 판단해요.
      const nearEnd =
        duration !== null && position !== null && position >= duration - 3;
      await this.player.sleep(nearEnd ? 120 : 300);
    }
  }
}
