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
  const out = await osa('tell application "Music" to player state');
  switch (out) {
    case "playing":
    case "paused":
    case "stopped":
      return out;
    default:
      throw new Error(`Unexpected Music player state: ${out}`);
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
    // 미지원 버전은 단순 재생으로 폴백해요.
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
  pause(): Promise<void>;
  resume(): Promise<void>;
  restart(): Promise<void>;
  currentTrackId(): Promise<number | null>;
  playerState(): Promise<PlayerState>;
  position(): Promise<number | null>;
  duration(): Promise<number | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
};

export const musicDriver: PlaybackDriver = {
  play: playSong,
  stop: () => osa('tell application "Music" to stop').then(() => undefined),
  pause: () => osa('tell application "Music" to pause').then(() => undefined),
  resume: () => osa('tell application "Music" to play').then(() => undefined),
  restart: () =>
    osa('tell application "Music" to set player position to 0').then(
      () => undefined,
    ),
  currentTrackId: readCurrentTrackId,
  playerState: getPlayerState,
  position: getPlayerPosition,
  duration: getTrackDuration,
  sleep,
  now: Date.now,
};
