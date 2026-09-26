import type { QueueService } from "../queue/queue.service";
import type { Song } from "../shared/types";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function osa(script: string): Promise<string> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`osascript failed: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout.trim();
}

type PlayerState = "playing" | "paused" | "stopped";

export type TrackNavigator = {
  readonly currentTrackId: () => Promise<number | null>;
  readonly nextTrack: () => Promise<void>;
};

export type VolumeController = {
  readonly getVolume: () => Promise<number>;
  readonly setVolume: (volume: number) => Promise<void>;
};

export async function withMutedVolume<T>(
  controller: VolumeController,
  work: () => Promise<T>,
): Promise<T> {
  const volume = await controller.getVolume();
  await controller.setVolume(0);
  try {
    return await work();
  } finally {
    await controller.setVolume(volume);
  }
}

async function getPlayerState(): Promise<PlayerState> {
  try {
    const out = await osa('tell application "Music" to player state');
    return out as PlayerState;
  } catch (error) {
    if (error instanceof Error) return "stopped";
    throw error;
  }
}

async function readCurrentTrackId(): Promise<number | null> {
  try {
    const out = await osa(
      'tell application "Music" to get id of current track',
    );
    const id = Number(out);
    return Number.isFinite(id) ? id : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

async function getVolume(): Promise<number> {
  const out = await osa('tell application "Music" to sound volume');
  return Number(out) || 0;
}

async function setVolume(v: number): Promise<void> {
  await osa(
    `tell application "Music" to set sound volume to ${Math.max(
      0,
      Math.min(100, v),
    )}`,
  );
}

async function getPlayerPosition(): Promise<number | null> {
  try {
    const out = await osa('tell application "Music" to get player position');
    const n = Number(out);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

async function getTrackDuration(): Promise<number | null> {
  try {
    const out = await osa(
      'tell application "Music" to get duration of current track',
    );
    const n = Number(out);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

async function waitForCurrentTrackId(
  currentTrackId: TrackNavigator["currentTrackId"],
  timeoutMs = 8000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await currentTrackId();
    if (id !== null) return id;
    await sleep(100);
  }
  throw new Error("Music.app did not expose a current track");
}

async function waitForTrackChange(
  navigator: TrackNavigator,
  previousTrackId: number,
  timeoutMs = 5000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await navigator.currentTrackId();
    if (id !== null && id !== previousTrackId) return id;
    await sleep(100);
  }
  throw new Error("Music.app did not finish the requested track transition");
}

export async function advanceThroughAlbum(
  navigator: TrackNavigator,
  skips: number,
): Promise<void> {
  let previousTrackId = await waitForCurrentTrackId(navigator.currentTrackId);
  for (let index = 0; index < skips; index += 1) {
    await navigator.nextTrack();
    previousTrackId = await waitForTrackChange(navigator, previousTrackId);
  }
}

// Music.app은 곡 선택자를 무시하고 앨범 첫 곡을 열어요.
// 음소거한 채 요청 트랙까지 넘긴 뒤 원래 음량으로 복원해요.
export async function playSong(song: Song): Promise<void> {
  const albumUrl = song.albumUrl.replace(/"/g, "");
  const skips = Math.max(0, song.trackNumber - 1);

  await osa('tell application "Music" to stop');
  await osa('tell application "Music" to set song repeat to off');
  await osa('tell application "Music" to set shuffle enabled to false');
  await osa(`tell application "Music" to open location "${albumUrl}"`);
  await sleep(2000);

  await withMutedVolume({ getVolume, setVolume }, async () => {
    await osa('tell application "Music" to play');
    await advanceThroughAlbum(
      {
        currentTrackId: readCurrentTrackId,
        nextTrack: () =>
          osa('tell application "Music" to next track').then(() => undefined),
      },
      skips,
    );
    // once 파라미터: 요청 트랙 하나만 재생 대기에 남기고 앨범 대기열을 지운다. 미지원 버전은 단순 재생으로 폴백.
    try {
      await osa('tell application "Music" to play (current track) once true');
    } catch {
      await osa('tell application "Music" to play');
    }
  });
}

// 테스트에서는 이 경계 전체를 주입해 실제 Music.app에 접근하지 않아요.
export type PlaybackDriver = {
  play(song: Song): Promise<void>;
  stop(): Promise<void>;
  currentTrackId(): Promise<number | null>;
  playerState(): Promise<PlayerState>;
  position(): Promise<number | null>;
  duration(): Promise<number | null>;
  sleep(ms: number): Promise<void>;
};

const musicDriver: PlaybackDriver = {
  play: playSong,
  stop: () => osa('tell application "Music" to stop').then(() => undefined),
  currentTrackId: readCurrentTrackId,
  playerState: getPlayerState,
  position: getPlayerPosition,
  duration: getTrackDuration,
  sleep,
};

export class PlaybackService {
  private commandChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly queue: QueueService,
    private readonly player: PlaybackDriver = musicDriver,
  ) {}

  skip(): Promise<void> {
    const song = this.queue.nowPlayingSong();
    return this.command(async () => {
      if (!song || !this.isCurrent(song.id)) return;
      await this.player.stop();
      await this.queue.finishNowPlaying("failed", song.id);
    });
  }

  async start(signal?: AbortSignal): Promise<void> {
    // 복원된 곡은 다시 틀지 않고 Music.app에서 끝나기를 기다려요.
    const restored = this.queue.nowPlayingSong();
    if (restored) {
      await this.waitForTrackEnd(
        restored.id,
        await this.player.currentTrackId(),
      );
      await this.command(() =>
        this.queue.finishNowPlaying("done", restored.id),
      );
    }
    while (!signal?.aborted) {
      // 재생 준비와 건너뛰기의 Music.app 명령이 서로 엇갈리지 않아요.
      const song = await this.command(async () => {
        const next = await this.queue.takeAndStart();
        if (!next) return null;
        try {
          await this.player.play(next);
        } catch (error) {
          await this.queue.finishNowPlaying("failed", next.id);
          console.error("playSong failed:", error);
          return null;
        }
        return next;
      });
      if (!song) {
        if (!signal?.aborted) await this.player.sleep(1000);
        continue;
      }

      const started = await this.waitForStart(song.id);
      if (!started) {
        await this.command(() =>
          this.queue.finishNowPlaying("failed", song.id),
        );
        continue;
      }

      await this.waitForTrackEnd(song.id, await this.player.currentTrackId());
      await this.command(() => this.queue.finishNowPlaying("done", song.id));
    }
  }

  private isCurrent(songId: string): boolean {
    return this.queue.nowPlayingSong()?.id === songId;
  }

  private command<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(task);
    this.commandChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async stopSong(songId: string): Promise<void> {
    await this.command(async () => {
      if (this.isCurrent(songId)) await this.player.stop();
    });
  }

  private async waitForStart(
    songId: string,
    timeoutMs = 12000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.isCurrent(songId) && Date.now() < deadline) {
      if ((await this.player.playerState()) === "playing")
        return this.isCurrent(songId);
      if (!this.isCurrent(songId)) return false;
      await this.player.sleep(400);
    }
    return false;
  }

  // 앨범 자동 진행으로 다음 곡이 들리지 않도록 트랙 변경과 곡 끝을 감시해요.
  private async waitForTrackEnd(
    songId: string,
    expectedTrackId: number | null,
  ): Promise<void> {
    const duration = await this.player.duration();
    if (duration !== null) this.queue.updateProgress(0, duration, songId);
    const deadline =
      Date.now() +
      (duration !== null ? (duration + 15) * 1000 : 15 * 60 * 1000);
    while (this.isCurrent(songId) && Date.now() < deadline) {
      const position = await this.player.position();
      if (position !== null)
        this.queue.updateProgress(position, duration, songId);
      if ((await this.player.playerState()) === "stopped") return;
      if (expectedTrackId !== null) {
        const id = await this.player.currentTrackId();
        if (id !== null && id !== expectedTrackId) {
          await this.stopSong(songId);
          return;
        }
      }
      if (
        duration !== null &&
        position !== null &&
        position >= duration - 0.15
      ) {
        await this.stopSong(songId);
        return;
      }
      if (!this.isCurrent(songId)) return;
      const nearEnd =
        duration !== null && position !== null && position >= duration - 3;
      await this.player.sleep(nearEnd ? 120 : 300);
    }
    await this.stopSong(songId);
  }
}
