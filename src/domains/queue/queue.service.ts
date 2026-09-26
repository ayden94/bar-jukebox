import { emit } from "../shared/bus";
import type { NowPlaying, Song } from "../shared/types";
import type { QueueRepository } from "./queue.repository";

const MAX_HISTORY = 50;

export type QueueSnapshot = {
  nowPlaying: NowPlaying | null;
  queue: Song[];
  history: Song[];
};

export class QueueService {
  private nowPlaying: NowPlaying | null = null;
  private queue: Song[] = [];
  private history: Song[] = [];
  private lastProgressSec = -1;

  constructor(private readonly repository: QueueRepository) {}

  // 부팅 복원 전용 — 저장을 일으키지 않는다.
  hydrate(snapshot: QueueSnapshot): void {
    this.nowPlaying = snapshot.nowPlaying;
    this.queue = snapshot.queue;
    this.history = snapshot.history;
  }

  snapshot(): QueueSnapshot {
    return {
      nowPlaying: this.nowPlaying ? { ...this.nowPlaying } : null,
      queue: [...this.queue],
      history: [...this.history],
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

  nowPlayingSong(): Song | null {
    return this.nowPlaying?.song ?? null;
  }

  enqueue(song: Song): void {
    this.queue.push(song);
    emit("mutate");
    this.persist(this.repository.insertQueueSong(song, this.queue.length - 1));
  }

  takeNext(): Song | null {
    const song = this.queue.shift() ?? null;
    if (song) this.persist(this.repository.removeQueueSong(song.id));
    return song;
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
    this.persist(
      this.repository.setNowPlaying(song, this.nowPlaying.startedAt),
    );
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
    const song = this.nowPlaying?.song;
    if (!song) return;
    if (result === "done") {
      this.history.unshift(song);
      if (this.history.length > MAX_HISTORY) this.history.pop();
    }
    this.nowPlaying = null;
    this.lastProgressSec = -1;
    emit("mutate");
    if (result === "done") {
      this.persist(this.repository.prependHistory(song, MAX_HISTORY));
    }
    this.persist(this.repository.clearNowPlaying());
  }

  removeFromQueue(id: string): boolean {
    const idx = this.queue.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    emit("mutate");
    this.persist(this.repository.removeQueueSong(id));
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
    this.persist(this.repository.replaceQueuePositions(next));
  }

  private persist(task: Promise<void>): void {
    void task.catch((e) => console.error("queue persist failed:", e));
  }
}
