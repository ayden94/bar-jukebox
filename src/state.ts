import { emit } from "./bus";
import type { JukeboxState, NowPlaying, Song } from "./types";

const MAX_HISTORY = 50;

class JukeboxStateStore {
  private nowPlaying: NowPlaying | null = null;
  private queue: Song[] = [];
  private history: Song[] = [];
  private requestsPaused = false;
  private notice = "";
  private lastProgressSec = -1;

  hydrate(snapshot: JukeboxState): void {
    this.nowPlaying = snapshot.nowPlaying;
    this.queue = snapshot.queue;
    this.history = snapshot.history;
    this.requestsPaused = snapshot.requestsPaused;
    this.notice = snapshot.notice;
  }

  snapshot(): JukeboxState {
    return {
      nowPlaying: this.nowPlaying ? { ...this.nowPlaying } : null,
      queue: [...this.queue],
      history: [...this.history],
      requestsPaused: this.requestsPaused,
      notice: this.notice,
    };
  }

  deviceHasActive(deviceId: string): boolean {
    if (this.nowPlaying?.song.deviceId === deviceId) return true;
    return this.queue.some((song) => song.deviceId === deviceId);
  }

  trackIsActive(trackId: number): boolean {
    if (this.nowPlaying?.song.trackId === trackId) return true;
    return this.queue.some((song) => song.trackId === trackId);
  }

  isRequestsPaused(): boolean {
    return this.requestsPaused;
  }

  getNotice(): string {
    return this.notice;
  }

  setRequestsPaused(paused: boolean): void {
    this.requestsPaused = paused;
    emit("mutate");
  }

  setNotice(notice: string): void {
    this.notice = notice;
    emit("mutate");
  }

  enqueue(song: Song): void {
    this.queue.push(song);
    emit("mutate");
  }

  takeNext(): Song | null {
    return this.queue.shift() ?? null;
  }

  setNowPlaying(song: Song): void {
    this.nowPlaying = {
      song,
      startedAt: Date.now(),
      status: "playing",
      positionSec: 0,
      durationSec: null,
    };
    this.lastProgressSec = -1;
    emit("mutate");
  }

  nowPlayingSong(): Song | null {
    return this.nowPlaying?.song ?? null;
  }

  updateProgress(positionSec: number, durationSec: number | null): void {
    if (!this.nowPlaying) return;
    const pos = Math.max(0, Math.round(positionSec));
    this.nowPlaying.positionSec = pos;
    this.nowPlaying.durationSec = durationSec;
    if (pos !== this.lastProgressSec) {
      this.lastProgressSec = pos;
      emit("progress");
    }
  }

  finishNowPlaying(result: "done" | "failed"): void {
    if (!this.nowPlaying) return;
    if (result === "done") {
      this.history.unshift(this.nowPlaying.song);
      if (this.history.length > MAX_HISTORY) this.history.pop();
    }
    this.nowPlaying = null;
    this.lastProgressSec = -1;
    emit("mutate");
  }

  removeFromQueue(id: string): boolean {
    const idx = this.queue.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    emit("mutate");
    return true;
  }

  removeOwnedFromQueue(id: string, deviceId: string): boolean {
    const song = this.queue.find((s) => s.id === id);
    if (!song || song.deviceId !== deviceId) return false;
    return this.removeFromQueue(id);
  }

  reorder(ids: string[]): void {
    const map = new Map(this.queue.map((s) => [s.id, s]));
    const next: Song[] = [];
    for (const id of ids) {
      const song = map.get(id);
      if (song) {
        next.push(song);
        map.delete(id);
      }
    }
    for (const remaining of map.values()) next.push(remaining);
    this.queue = next;
    emit("mutate");
  }
}

export const state = new JukeboxStateStore();
