import { asc, eq, sql } from "drizzle-orm";
import { type Drizzle, databaseOperation } from "../../infra/db";
import {
  history,
  nowPlaying,
  playbackAttempts,
  playbackOwner,
  queue,
} from "../../infra/schema";
import {
  assertAttempt,
  assertOwner,
  finishPlayback,
  reservePlayback,
} from "../playback/playback.repository";
import type {
  BrowserStoppedFence,
  PlaybackFence,
  PlaybackReservation,
} from "../playback/protocol";
import type { Song } from "../shared/types";
import {
  decodePersistedSong,
  isStoredTimestamp,
  PersistedSongError,
} from "./persisted-song";

export type StoredNowPlaying = {
  song: Song;
  startedAt: number | null;
  reservedAt?: number;
};
type Transaction = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];

// 서비스가 의존하는 저장소 포트. 재생 전환은 각각 하나의 트랜잭션이에요.
export interface QueueRepository {
  loadQueue(): Promise<Song[]>;
  loadHistory(): Promise<Song[]>;
  loadNowPlaying(): Promise<StoredNowPlaying | null>;
  insertQueueSong(song: Song): Promise<void>;
  removeQueueSong(id: string): Promise<void>;
  replaceQueuePositions(songs: Song[]): Promise<void>;
  takeAndStart(
    song: Song,
    startedAt: number,
    reservation?: PlaybackReservation,
  ): Promise<void>;
  restartNowPlaying(
    startedAt: number,
    reservation?: PlaybackReservation,
  ): Promise<void>;
  returnToPrevious(
    current: Song,
    previous: Song,
    startedAt: number,
    reservation?: PlaybackReservation,
  ): Promise<void>;
  finishNowPlaying(
    song: Song,
    result: "done" | "failed",
    max: number,
    fence?: PlaybackFence,
    finishedAt?: number,
  ): Promise<void>;
  confirmBrowserStopped(
    song: Song | null,
    fence: BrowserStoppedFence,
    max: number,
    finishedAt: number,
  ): Promise<void>;
}

export class DrizzleQueueRepository implements QueueRepository {
  constructor(private readonly db: Drizzle) {}

  // 실패는 호출자에게 전달하되 다음 쓰기는 계속 처리해요.
  private serialize(task: () => Promise<void>): Promise<void> {
    return databaseOperation(this.db, task);
  }

  async loadQueue(): Promise<Song[]> {
    return databaseOperation(this.db, async () => {
      const rows = await this.db
        .select()
        .from(queue)
        .orderBy(asc(queue.position));
      return rows.map((row) => decodePersistedSong(row.data, "queue", row.id));
    });
  }

  async loadHistory(): Promise<Song[]> {
    return databaseOperation(this.db, async () => {
      const rows = await this.db
        .select()
        .from(history)
        .orderBy(asc(history.position));
      return rows.map((row) =>
        decodePersistedSong(row.data, "history", row.id),
      );
    });
  }

  async loadNowPlaying(): Promise<StoredNowPlaying | null> {
    return databaseOperation(this.db, async () => {
      const rows = await this.db
        .select()
        .from(nowPlaying)
        .where(eq(nowPlaying.id, 1));
      const row = rows[0];
      if (!row) return null;
      const song = decodePersistedSong(row.data, "now_playing", row.id);
      if (!isStoredTimestamp(row.startedAt)) {
        throw new PersistedSongError(
          "now_playing",
          row.id,
          "invalid-started-at",
        );
      }
      const attempt = (
        await this.db
          .select()
          .from(playbackAttempts)
          .where(eq(playbackAttempts.active, true))
      )[0]?.data;
      return attempt
        ? { song, startedAt: attempt.startedAt, reservedAt: attempt.reservedAt }
        : { song, startedAt: row.startedAt };
    });
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

  takeAndStart(
    song: Song,
    startedAt: number,
    reservation?: PlaybackReservation,
  ): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        if (reservation) await reservePlayback(tx, reservation);
        else await this.assertLegacy(tx);
        await this.removeAndCompact(tx, song.id);
        await tx
          .insert(nowPlaying)
          .values({ id: 1, data: JSON.stringify(song), startedAt });
      }),
    );
  }

  restartNowPlaying(
    startedAt: number,
    reservation?: PlaybackReservation,
  ): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        if (reservation) await reservePlayback(tx, reservation);
        else await this.assertLegacy(tx);
        await tx
          .update(nowPlaying)
          .set({ startedAt })
          .where(eq(nowPlaying.id, 1));
      }),
    );
  }

  returnToPrevious(
    current: Song,
    previous: Song,
    startedAt: number,
    reservation?: PlaybackReservation,
  ): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        if (reservation) await reservePlayback(tx, reservation);
        else await this.assertLegacy(tx);
        await tx.update(queue).set({
          position: sql`${queue.position} + 1`,
        });
        await tx.insert(queue).values({
          id: current.id,
          data: JSON.stringify(current),
          position: 0,
        });
        await tx.delete(history).where(eq(history.id, previous.id));
        await tx
          .update(history)
          .set({ position: sql`${history.position} - 1` });
        await tx
          .update(nowPlaying)
          .set({
            data: JSON.stringify(previous),
            startedAt,
          })
          .where(eq(nowPlaying.id, 1));
      }),
    );
  }

  finishNowPlaying(
    song: Song,
    result: "done" | "failed",
    max: number,
    fence?: PlaybackFence,
    finishedAt = Date.now(),
  ): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        if (fence) {
          const attempt = await assertAttempt(tx, fence);
          if (attempt && attempt.songId !== song.id)
            throw new Error("오래된 신청곡이에요");
          await finishPlayback(tx, fence, finishedAt);
        } else await this.assertLegacy(tx);
        await this.finishSong(tx, song, result, max);
      }),
    );
  }

  confirmBrowserStopped(
    song: Song | null,
    fence: BrowserStoppedFence,
    max: number,
    finishedAt: number,
  ): Promise<void> {
    return this.serialize(() =>
      this.db.transaction(async (tx) => {
        const owner = await assertOwner(tx, fence);
        if (owner.connection.location !== "browser")
          throw new Error("브라우저 재생 소유권이 아니에요");
        const attempt = await assertAttempt(tx, fence);
        if (
          (song?.id ?? null) !== fence.songId ||
          (attempt?.songId ?? null) !== fence.songId ||
          (attempt &&
            attempt.state !== "waiting" &&
            attempt.state !== "reconciliation-required")
        )
          throw new Error("오래된 신청곡이에요");
        if (song) {
          await finishPlayback(tx, fence, finishedAt);
          await this.finishSong(tx, song, "done", max);
        } else if ((await tx.select().from(nowPlaying)).length > 0) {
          throw new Error("현재 재생 중인 신청을 먼저 확인해 주세요");
        }
        // 완료/history와 해제가 함께 commit돼야 다음 wake가 예약할 수 없어요.
        await tx
          .update(playbackOwner)
          .set({ data: { ...owner, stopConfirmed: true, released: true } })
          .where(eq(playbackOwner.id, 1));
      }),
    );
  }

  private async finishSong(
    tx: Transaction,
    song: Song,
    result: "done" | "failed",
    max: number,
  ): Promise<void> {
    const current = (
      await tx.select().from(nowPlaying).where(eq(nowPlaying.id, 1))
    )[0];
    if (
      !current ||
      decodePersistedSong(current.data, "now_playing", 1).id !== song.id
    ) {
      throw new Error("오래된 신청곡이에요");
    }
    if (result === "done") {
      const rows = await tx
        .select()
        .from(history)
        .orderBy(asc(history.position));
      const existing = rows
        .map((row) => decodePersistedSong(row.data, "history", row.id))
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
  }

  private async assertLegacy(tx: Transaction): Promise<void> {
    const active = await tx
      .select()
      .from(playbackAttempts)
      .where(eq(playbackAttempts.active, true));
    if (active.length > 0)
      throw new Error("재생 시도와 소유권 확인이 필요해요");
  }
}
