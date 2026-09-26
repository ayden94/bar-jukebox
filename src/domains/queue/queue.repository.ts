import { asc, eq } from "drizzle-orm";
import type { Drizzle } from "../../infra/db";
import { history, nowPlaying, queue } from "../../infra/schema";
import type { Song } from "../shared/types";

export type StoredNowPlaying = { song: Song; startedAt: number };

// 서비스가 의존하는 저장소 포트. 테스트는 이 인터페이스를 흉내 낸 가짜를 주입한다.
export interface QueueRepository {
  loadQueue(): Promise<Song[]>;
  loadHistory(): Promise<Song[]>;
  loadNowPlaying(): Promise<StoredNowPlaying | null>;
  insertQueueSong(song: Song, position: number): Promise<void>;
  removeQueueSong(id: string): Promise<void>;
  replaceQueuePositions(songs: Song[]): Promise<void>;
  setNowPlaying(song: Song, startedAt: number): Promise<void>;
  clearNowPlaying(): Promise<void>;
  prependHistory(song: Song, max: number): Promise<void>;
}

function parseSong(json: string): Song | null {
  try {
    return JSON.parse(json) as Song;
  } catch {
    return null;
  }
}

export class DrizzleQueueRepository implements QueueRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly db: Drizzle) {}

  // 연속 쓰기 사이에 순서가 뒤섞이지 않도록 직렬화한다 (fire-and-forget 저장 대응).
  private serialize(task: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async loadQueue(): Promise<Song[]> {
    const rows = await this.db
      .select()
      .from(queue)
      .orderBy(asc(queue.position));
    return rows
      .map((row) => parseSong(row.data))
      .filter((song): song is Song => song !== null);
  }

  async loadHistory(): Promise<Song[]> {
    const rows = await this.db
      .select()
      .from(history)
      .orderBy(asc(history.position));
    return rows
      .map((row) => parseSong(row.data))
      .filter((song): song is Song => song !== null);
  }

  async loadNowPlaying(): Promise<StoredNowPlaying | null> {
    const rows = await this.db
      .select()
      .from(nowPlaying)
      .where(eq(nowPlaying.id, 1));
    const row = rows[0];
    if (!row) return null;
    const song = parseSong(row.data);
    return song ? { song, startedAt: row.startedAt } : null;
  }

  insertQueueSong(song: Song, position: number): Promise<void> {
    return this.serialize(async () => {
      await this.db
        .insert(queue)
        .values({ id: song.id, data: JSON.stringify(song), position });
    });
  }

  removeQueueSong(id: string): Promise<void> {
    return this.serialize(async () => {
      await this.db.delete(queue).where(eq(queue.id, id));
    });
  }

  replaceQueuePositions(songs: Song[]): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        await tx.delete(queue);
        if (songs.length > 0) {
          await tx.insert(queue).values(
            songs.map((song, index) => ({
              id: song.id,
              data: JSON.stringify(song),
              position: index,
            })),
          );
        }
      }),
    );
  }

  setNowPlaying(song: Song, startedAt: number): Promise<void> {
    return this.serialize(async () => {
      await this.db
        .insert(nowPlaying)
        .values({ id: 1, data: JSON.stringify(song), startedAt })
        .onConflictDoUpdate({
          target: nowPlaying.id,
          set: { data: JSON.stringify(song), startedAt },
        });
    });
  }

  clearNowPlaying(): Promise<void> {
    return this.serialize(async () => {
      await this.db.delete(nowPlaying).where(eq(nowPlaying.id, 1));
    });
  }

  prependHistory(song: Song, max: number): Promise<void> {
    return this.serialize(async () => {
      const rows = await this.db
        .select()
        .from(history)
        .orderBy(asc(history.position));
      const existing = rows
        .map((row) => parseSong(row.data))
        .filter((s): s is Song => s !== null)
        .slice(0, Math.max(0, max - 1));
      const next = [song, ...existing];
      await this.db.transaction(async (tx) => {
        await tx.delete(history);
        await tx.insert(history).values(
          next.map((s, index) => ({
            id: s.id,
            data: JSON.stringify(s),
            position: index,
          })),
        );
      });
    });
  }
}
