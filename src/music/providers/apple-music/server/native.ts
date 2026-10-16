import type { PreparedTrack } from "./catalog";

export type ScriptRunner = (
  script: string,
  signal: AbortSignal,
) => Promise<string>;

export type NativeSnapshot = {
  state: "playing" | "paused" | "stopped";
  id: string;
  persistentId: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  discNumber: number;
  positionSec: number | null;
  durationSec: number | null;
};

export const snapshotScript = `-- jukebox:snapshot
tell application "Music"
  set s to player state as text
  try
    set t to current track
    set fields to {s, id of t as text, persistent ID of t as text, name of t, artist of t, album of t, track number of t as text, disc number of t as text, player position as text, duration of t as text}
  on error
    return s
  end try
  set AppleScript's text item delimiters to ASCII character 31
  return fields as text
end tell`;

export function parseSnapshot(output: string): NativeSnapshot | null {
  const fields = output.trim().split("\x1f");
  const [state, id, persistentId, title, artist, album, track, disc, pos, dur] =
    fields;
  if (
    fields.length !== 10 ||
    !["playing", "paused", "stopped"].includes(state ?? "") ||
    !id ||
    !persistentId ||
    !title ||
    !artist ||
    !album ||
    !track ||
    !disc
  ) {
    return null;
  }
  const trackNumber = Number(track);
  const discNumber = Number(disc);
  if (
    !Number.isSafeInteger(trackNumber) ||
    trackNumber < 1 ||
    !Number.isSafeInteger(discNumber) ||
    discNumber < 1
  ) {
    return null;
  }
  const number = (text: string | undefined) => {
    if (!text?.trim()) {
      return null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    state: state as NativeSnapshot["state"],
    id,
    persistentId,
    title,
    artist,
    album,
    trackNumber,
    discNumber,
    positionSec: number(pos),
    durationSec: number(dur),
  };
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;
}

export function prepareScript(
  track: PreparedTrack,
  initialState: "playing" | "paused",
): string {
  return `-- jukebox:prepare
tell application "Music"
  set originalVolume to sound volume
  set deadline to (current date) + 30
  set sound volume to 0
  try
    stop
    set song repeat to off
    set shuffle enabled to false
    open location ${quote(track.albumUrl)}
    set loaded to false
    repeat 80 times
      try
        if ${track.album ? `album of current track is ${quote(track.album)} and ` : ""}track number of current track is 1 and disc number of current track is 1 then
          set loaded to true
          exit repeat
        end if
      end try
      delay 0.1
    end repeat
    if not loaded then error "album-not-loaded"
    play
    set found to false
    repeat 400 times
      if (current date) > deadline then error "track-timeout"
      set t to current track
      if track number of t is ${track.trackNumber} and disc number of t is ${track.discNumber} then
        if name of t is not ${quote(track.metadata.title)} or artist of t is not ${quote(track.metadata.artist)}${track.album ? ` or album of t is not ${quote(track.album)}` : ""} then error "track-mismatch"
        set found to true
        exit repeat
      end if
      set oldId to id of t
      next track
      set changed to false
      repeat 50 times
        if id of current track is not oldId then
          set changed to true
          exit repeat
        end if
        delay 0.1
      end repeat
      if not changed then error "track-not-changed"
    end repeat
    if not found then error "track-not-found"
    set player position to 0
    ${
      initialState === "paused"
        ? "pause"
        : `try
      play (current track) once true
    on error
      play
    end try`
    }
    set sound volume to originalVolume
  on error messageText number errorNumber
    set sound volume to originalVolume
    error messageText number errorNumber
  end try
end tell
${snapshotScript}`;
}

export function controlScript(
  snapshot: NativeSnapshot,
  action: string,
): string {
  return `-- jukebox:control
tell application "Music"
  if (id of current track as text) is not ${quote(snapshot.id)} or (persistent ID of current track as text) is not ${quote(snapshot.persistentId)} then return "mismatch"
  ${action}
  return "applied"
end tell`;
}

export const runAppleScript: ScriptRunner = async (script, signal) => {
  signal.throwIfAborted();
  const process = Bun.spawn(
    [
      "osascript",
      "-e",
      `use framework "AppKit"
current application's NSApplication's sharedApplication()'s setActivationPolicy:2
${script}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  // 발행 후에는 스크립트의 음량 복원까지 기다려요. 취소는 적용 불명으로 반환돼요.
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.includes("-1743") ? "permission-denied" : "native-failure",
    );
  }
  signal.throwIfAborted();
  return stdout.trim();
};
