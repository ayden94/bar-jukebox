import { emit } from "../shared/bus";
import type { NowPlaying, Song } from "../shared/types";
import type { QueueRepository } from "./queue.repository";

const MAX_HISTORY = 50;

export type QueueSnapshot = {
  nowPlaying: NowPlaying | null;
  queue: Song[];
  history: Song[];
};

export type EnqueueLimits = { maxPerDevice: number; maxPerTable: number };

export type EnqueueDeniedReason =
  | "device-limit"
  | "table-limit"
  | "duplicate-track";

export class QueueService {
  private nowPlaying: NowPlaying | null = null;
  private queue: Song[] = [];
  private history: Song[] = [];
  private lastProgressSec = -1;
  private mutationChain: Promise<void> = Promise.resolve();

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

  // 신청 규칙 판정: 대기+재생중을 "활성"으로 보고 중복/기기 상한/테이블 상한을 검사한다.
  enqueueDeniedReason(
    song: Song,
    limits: EnqueueLimits,
  ): EnqueueDeniedReason | null {
    if (song.isStaff) return null;
    if (
      song.deviceId &&
      limits.maxPerDevice > 0 &&
      this.activeCount((s) => s.deviceId === song.deviceId) >=
        limits.maxPerDevice
    ) {
      return "device-limit";
    }
    if (
      song.tableId != null &&
      limits.maxPerTable > 0 &&
      this.activeCount((s) => s.tableId === song.tableId) >= limits.maxPerTable
    ) {
      return "table-limit";
    }
    if (this.trackIsActive(song.trackId)) return "duplicate-track";
    return null;
  }

  private activeCount(match: (song: Song) => boolean): number {
    let count = this.queue.filter(match).length;
    if (this.nowPlaying && match(this.nowPlaying.song)) count += 1;
    return count;
  }

  nowPlayingSong(): Song | null {
    return this.nowPlaying?.song ?? null;
  }

  enqueue(
    song: Song,
    limits: EnqueueLimits = { maxPerDevice: 1, maxPerTable: 5 },
  ): Promise<EnqueueDeniedReason | null> {
    return this.mutate(async () => {
      const denied = this.enqueueDeniedReason(song, limits);
      if (denied) return denied;
      await this.repository.insertQueueSong(song);
      this.queue.push(song);
      emit("mutate");
      return null;
    });
  }

  takeAndStart(): Promise<Song | null> {
    return this.mutate(async () => {
      if (this.nowPlaying) return null;
      const song = this.queue[0];
      if (!song) return null;
      const startedAt = Date.now();
      await this.repository.takeAndStart(song, startedAt);
      this.queue.shift();
      this.nowPlaying = {
        song,
        startedAt,
        status: "playing",
        positionSec: 0,
        durationSec: null,
      };
      this.lastProgressSec = -1;
      emit("mutate");
      return song;
    });
  }

  updateProgress(
    positionSec: number,
    durationSec: number | null,
    expectedSongId?: string,
  ): void {
    if (
      !this.nowPlaying ||
      (expectedSongId !== undefined &&
        this.nowPlaying.song.id !== expectedSongId)
    )
      return;
    const pos = Math.max(0, Math.round(positionSec));
    this.nowPlaying.positionSec = pos;
    this.nowPlaying.durationSec = durationSec;
    if (pos !== this.lastProgressSec) {
      this.lastProgressSec = pos;
      emit("progress");
    }
  }

  finishNowPlaying(
    result: "done" | "failed",
    expectedSongId: string,
  ): Promise<boolean> {
    return this.mutate(async () => {
      const song = this.nowPlaying?.song;
      // 이전 곡의 완료/건너뛰기 요청이 다음 곡을 지우지 않아요.
      if (!song || song.id !== expectedSongId) return false;
      await this.repository.finishNowPlaying(song, result, MAX_HISTORY);
      if (result === "done") {
        this.history.unshift(song);
        if (this.history.length > MAX_HISTORY) this.history.pop();
      }
      this.nowPlaying = null;
      this.lastProgressSec = -1;
      emit("mutate");
      return true;
    });
  }

  removeFromQueue(id: string): Promise<boolean> {
    return this.mutate(() => this.remove(id));
  }

  removeOwnedFromQueue(id: string, deviceId: string): Promise<boolean> {
    return this.mutate(async () => {
      const song = this.queue.find((s) => s.id === id);
      if (!song || song.deviceId !== deviceId) return false;
      return this.remove(id);
    });
  }

  private async remove(id: string): Promise<boolean> {
    const idx = this.queue.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    await this.repository.removeQueueSong(id);
    this.queue.splice(idx, 1);
    emit("mutate");
    return true;
  }

  reorder(ids: string[]): Promise<void> {
    return this.mutate(async () => {
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
      await this.repository.replaceQueuePositions(next);
      this.queue = next;
      emit("mutate");
    });
  }

  // 규칙 판정부터 저장·메모리 반영까지 하나의 순서로 처리해요.
  private mutate<T>(task: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(task);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
