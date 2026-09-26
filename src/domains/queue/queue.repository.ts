import { asc, eq, sql } from "drizzle-orm";
import type { Drizzle } from "../../infra/db";
import { history, nowPlaying, queue } from "../../infra/schema";
import type { Song } from "../shared/types";

export type StoredNowPlaying = { song: Song; startedAt: number };
type Transaction = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];

// 서비스가 의존하는 저장소 포트. 재생 전환은 각각 하나의 트랜잭션이에요.
export interface QueueRepository {
  loadQueue(): Promise<Song[]>;
  loadHistory(): Promise<Song[]>;
  loadNowPlaying(): Promise<StoredNowPlaying | null>;
  insertQueueSong(song: Song): Promise<void>;
  removeQueueSong(id: string): Promise<void>;
  replaceQueuePositions(songs: Song[]): Promise<void>;
  takeAndStart(song: Song, startedAt: number): Promise<void>;
  finishNowPlaying(
    song: Song,
    result: "done" | "failed",
    max: number,
  ): Promise<void>;
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

  // 실패는 호출자에게 전달하되 다음 쓰기는 계속 처리해요.
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

  insertQueueSong(song: Song): Promise<void> {
    return this.serialize(async () => {
      await this.db.insert(queue).values({
        id: song.id,
        data: JSON.stringify(song),
        // 예전 버전이 남긴 위치 공백도 새 곡의 순서를 바꾸지 않아요.
        position: sql`(select coalesce(max(${queue.position}), -1) + 1 from ${queue})`,
      });
    });
  }

  private async removeAndCompact(tx: Transaction, id: string): Promise<void> {
    await tx.delete(queue).where(eq(queue.id, id));
    const rows = await tx.select().from(queue).orderBy(asc(queue.position));
    await tx.delete(queue);
    if (rows.length > 0) {
      await tx
        .insert(queue)
        .values(rows.map((row, position) => ({ ...row, position })));
    }
  }

  removeQueueSong(id: string): Promise<void> {
    return this.serialize(() =>
      this.db.transaction((tx) => this.removeAndCompact(tx, id)),
    );
  }

  replaceQueuePositions(songs: Song[]): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        await tx.delete(queue);
        if (songs.length > 0) {
          await tx.insert(queue).values(
            songs.map((song, position) => ({
              id: song.id,
              data: JSON.stringify(song),
              position,
            })),
          );
        }
      }),
    );
  }

  takeAndStart(song: Song, startedAt: number): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        await this.removeAndCompact(tx, song.id);
        await tx
          .insert(nowPlaying)
          .values({ id: 1, data: JSON.stringify(song), startedAt });
      }),
    );
  }

  finishNowPlaying(
    song: Song,
    result: "done" | "failed",
    max: number,
  ): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        if (result === "done") {
          const rows = await tx
            .select()
            .from(history)
            .orderBy(asc(history.position));
          const existing = rows
            .map((row) => parseSong(row.data))
            .filter((stored): stored is Song => stored !== null)
            .slice(0, Math.max(0, max - 1));
          await tx.delete(history);
          await tx.insert(history).values(
            [song, ...existing].map((entry, position) => ({
              id: entry.id,
              data: JSON.stringify(entry),
              position,
            })),
          );
        }
        await tx.delete(nowPlaying).where(eq(nowPlaying.id, 1));
      }),
    );
  }
}
