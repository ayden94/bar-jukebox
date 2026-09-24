import { state } from "./state";
import type { Song } from "./types";

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
    `tell application "Music" to set sound volume to ${Math.max(0, Math.min(100, v))}`,
  );
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

// Music.app's `open location` with a music:// album URL plays the album from
// track 1 (the ?i= song selector is ignored). To play the requested song we
// mute, start track 1, advance with `next track` to the target track, then
// restore volume — so the wrong-track fragments stay silent.
export async function playSong(song: Song): Promise<void> {
  const albumUrl = song.albumUrl.replace(/"/g, "");
  const skips = Math.max(0, song.trackNumber - 1);

  await osa('tell application "Music" to stop');
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
    await osa('tell application "Music" to play');
  });
}

export async function stopPlayback(): Promise<void> {
  await osa('tell application "Music" to stop');
}

async function waitForStart(timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getPlayerState()) === "playing") return true;
    await sleep(400);
  }
  return false;
}

async function waitForEnd(): Promise<void> {
  while (true) {
    await sleep(1500);
    if ((await getPlayerState()) === "stopped") return;
  }
}

export async function startPlaybackLoop(): Promise<void> {
  while (true) {
    const song = state.takeNext();
    if (!song) {
      await sleep(1000);
      continue;
    }
    state.setNowPlaying(song);
    console.log(
      `\u25b6 playing: ${song.trackName} \u2014 ${song.artistName} (by ${song.requestedBy})`,
    );

    try {
      await playSong(song);
    } catch (e) {
      console.error("playSong failed:", e);
      state.finishNowPlaying("failed");
      continue;
    }

    const started = await waitForStart(12000);
    if (!started) {
      console.error(`\u2717 failed to start playback: ${song.trackName}`);
      state.finishNowPlaying("failed");
      continue;
    }

    await waitForEnd();
    state.finishNowPlaying("done");
    console.log(`\u25a0 finished: ${song.trackName}`);
  }
}
