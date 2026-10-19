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

// 카탈로그와 Music.app의 표기 차이(대소문자, 공백, 문장부호, 악센트, 유니코드 조합)를 무시해요.
export function sameText(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[\p{P}\p{S}\p{Z}\s]/gu, "");
  return normalize(a) === normalize(b);
}

const lenient =
  "ignoring case, diacriticals, hyphens, punctuation and white space";

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
        ${lenient}
          if ${track.album ? `album of current track is ${quote(track.album)} and ` : ""}track number of current track is 1 and disc number of current track is 1 then
            set loaded to true
          end if
        end ignoring
        if loaded then exit repeat
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
        ${lenient}
          set matches to (name of t is ${quote(track.metadata.title)} and artist of t is ${quote(track.metadata.artist)}${track.album ? ` and album of t is ${quote(track.album)}` : ""})
        end ignoring
        if not matches then error "track-mismatch"
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

export const volumeScript = `-- jukebox:volume
tell application "Music" to sound volume as text`;

// 준비 스크립트가 중간에 끊겨 음소거가 남았을 때만 되돌려요. 직원이 바꾼 음량은 건드리지 않아요.
export function restoreVolumeScript(volume: number): string {
  return `-- jukebox:restore-volume
tell application "Music"
  if sound volume is 0 then set sound volume to ${Math.round(volume)}
end tell`;
}

export function playlistsScript(): string {
  return `-- jukebox:playlists
tell application "Music"
  set names to name of every user playlist whose special kind is none
  set AppleScript's text item delimiters to ASCII character 31
  return names as text
end tell`;
}

export function startPlaylistScript(playlist: string): string {
  return `-- jukebox:background-start
tell application "Music"
  set target to user playlist ${quote(playlist)}
  set shuffle enabled to true
  set song repeat to all
  play target
  return name of current playlist
end tell`;
}

export function fadeOutScript(durationMs: number): string {
  const steps = 10;
  const delay = Math.max(0, durationMs / 1000 / steps).toFixed(2);
  return `-- jukebox:background-fade
tell application "Music"
  if player state is not playing then return "stopped"
  set originalVolume to sound volume
  try
    repeat with i from 1 to ${steps}
      set sound volume to (originalVolume * (${steps} - i) / ${steps})
      delay ${delay}
    end repeat
    stop
    set sound volume to originalVolume
  on error messageText number errorNumber
    set sound volume to originalVolume
    error messageText number errorNumber
  end try
  return "stopped"
end tell`;
}

export const backgroundScript = `-- jukebox:background
tell application "Music"
  set s to player state as text
  set p to ""
  try
    set p to name of current playlist
  end try
  try
    set t to current track
    set fields to {s, persistent ID of t as text, name of t, artist of t, p, player position as text, duration of t as text}
  on error
    set fields to {s, "", "", "", p, "", ""}
  end try
  set AppleScript's text item delimiters to ASCII character 31
  return fields as text
end tell`;

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
