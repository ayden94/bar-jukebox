import type { JukeboxState, NowPlaying, Song } from "./types";

const MAX_HISTORY = 50;

class JukeboxStateStore {
  private nowPlaying: NowPlaying | null = null;
  private queue: Song[] = [];
  private history: Song[] = [];

  snapshot(): JukeboxState {
    return {
      nowPlaying: this.nowPlaying ? { ...this.nowPlaying } : null,
      queue: [...this.queue],
      history: [...this.history],
    };
  }

  patronHasActive(patronKey: string): boolean {
    if (this.nowPlaying?.song.patronKey === patronKey) return true;
    return this.queue.some((s) => s.patronKey === patronKey);
  }

  enqueue(song: Song): void {
    this.queue.push(song);
  }

  takeNext(): Song | null {
    return this.queue.shift() ?? null;
  }

  setNowPlaying(song: Song): void {
    this.nowPlaying = { song, startedAt: Date.now(), status: "playing" };
  }

  nowPlayingSong(): Song | null {
    return this.nowPlaying?.song ?? null;
  }

  finishNowPlaying(result: "done" | "failed"): void {
    if (!this.nowPlaying) return;
    if (result === "done") {
      this.history.unshift(this.nowPlaying.song);
      if (this.history.length > MAX_HISTORY) this.history.pop();
    }
    this.nowPlaying = null;
  }

  removeFromQueue(id: string): boolean {
    const idx = this.queue.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  reorder(ids: string[]): void {
    const map = new Map(this.queue.map((s) => [s.id, s]));
    const next: Song[] = [];
    for (const id of ids) {
      const s = map.get(id);
      if (s) {
        next.push(s);
        map.delete(id);
      }
    }
    for (const remaining of map.values()) next.push(remaining);
    this.queue = next;
  }
}

export const state = new JukeboxStateStore();
