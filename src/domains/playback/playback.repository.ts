import { and, eq } from "drizzle-orm";
import { type Drizzle, databaseOperation } from "../../infra/db";
import {
  nowPlaying,
  playbackAttempts,
  playbackCommands,
  playbackOwner,
} from "../../infra/schema";
import type { PlaybackObservation } from "../../music/contracts";
import type {
  CommandState,
  DurableAttempt,
  DurableCommand,
  OwnerClaim,
  OwnerIdentity,
  PlaybackFence,
  PlaybackOwner,
  PlaybackReservation,
} from "./protocol";

export type PlaybackTransaction = Parameters<
  Parameters<Drizzle["transaction"]>[0]
>[0];

export async function assertOwner(
  tx: PlaybackTransaction,
  expected: OwnerIdentity,
): Promise<PlaybackOwner> {
  const row = (
    await tx.select().from(playbackOwner).where(eq(playbackOwner.id, 1))
  )[0];
  const owner = row?.data;
  if (
    !owner ||
    row.epoch !== expected.ownerEpoch ||
    owner.ownerEpoch !== expected.ownerEpoch ||
    owner.executorSessionId !== expected.executorSessionId ||
    owner.released
  ) {
    throw new Error("오래된 재생 소유권이에요");
  }
  return owner;
}

export async function assertAttempt(
  tx: PlaybackTransaction,
  fence: PlaybackFence,
): Promise<DurableAttempt | null> {
  await assertOwner(tx, fence);
  const row = (
    await tx
      .select()
      .from(playbackAttempts)
      .where(eq(playbackAttempts.active, true))
  )[0];
  if (
    (row?.id ?? null) !== fence.attemptId ||
    (row &&
      (row.ownerEpoch !== fence.ownerEpoch ||
        row.data.context.executorSessionId !== fence.executorSessionId))
  ) {
    throw new Error("오래된 재생 시도예요");
  }
  return row?.data ?? null;
}

export async function reservePlayback(
  tx: PlaybackTransaction,
  reservation: PlaybackReservation,
): Promise<void> {
  const { attempt, command, previousAttemptId } = reservation;
  const previous = await assertAttempt(tx, {
    ...attempt.context,
    ownerEpoch: attempt.ownerEpoch,
    attemptId: previousAttemptId ?? null,
  });
  if (previous) {
    await tx
      .update(playbackAttempts)
      .set({
        active: false,
        data: { ...previous, state: "superseded" },
      })
      .where(eq(playbackAttempts.id, previous.attemptId));
  }
  await tx.insert(playbackAttempts).values({
    id: attempt.attemptId,
    songId: attempt.songId,
    ownerEpoch: attempt.ownerEpoch,
    active: true,
    data: attempt,
  });
  await tx.insert(playbackCommands).values({
    id: command.command.context.commandId,
    attemptId: attempt.attemptId,
    ownerEpoch: attempt.ownerEpoch,
    data: command,
  });
  const owner = await assertOwner(tx, {
    ownerEpoch: attempt.ownerEpoch,
    executorSessionId: attempt.context.executorSessionId,
  });
  await tx
    .update(playbackOwner)
    .set({
      data: { ...owner, stopConfirmed: false },
    })
    .where(eq(playbackOwner.id, 1));
}

export async function finishPlayback(
  tx: PlaybackTransaction,
  fence: PlaybackFence,
  now: number,
): Promise<void> {
  const attempt = await assertAttempt(tx, fence);
  if (attempt) {
    await tx
      .update(playbackAttempts)
      .set({
        active: false,
        data: { ...attempt, state: "finished" },
      })
      .where(eq(playbackAttempts.id, attempt.attemptId));
    const rows = await tx
      .select()
      .from(playbackCommands)
      .where(eq(playbackCommands.attemptId, attempt.attemptId));
    for (const row of rows) {
      if (row.data.state === "confirmed" || row.data.state === "rejected")
        continue;
      await tx
        .update(playbackCommands)
        .set({
          data: { ...row.data, state: "unknown", updatedAt: now },
        })
        .where(eq(playbackCommands.id, row.id));
    }
  }
  const owner = await assertOwner(tx, fence);
  await tx
    .update(playbackOwner)
    .set({
      data: { ...owner, stopConfirmed: true },
    })
    .where(eq(playbackOwner.id, 1));
}

export class PlaybackRepository {
  constructor(private readonly db: Drizzle) {}

  private write<T>(work: (tx: PlaybackTransaction) => Promise<T>): Promise<T> {
    return databaseOperation(this.db, () => this.db.transaction(work));
  }

  async loadOwner(): Promise<PlaybackOwner | null> {
    return databaseOperation(this.db, async () => {
      const row = (
        await this.db
          .select()
          .from(playbackOwner)
          .where(eq(playbackOwner.id, 1))
      )[0];
      return row?.data ?? null;
    });
  }

  async loadAttempt(): Promise<DurableAttempt | null> {
    return databaseOperation(this.db, async () => {
      const row = (
        await this.db
          .select()
          .from(playbackAttempts)
          .where(eq(playbackAttempts.active, true))
      )[0];
      return row?.data ?? null;
    });
  }

  async loadCommands(attemptId?: string): Promise<DurableCommand[]> {
    return databaseOperation(this.db, async () => {
      const rows = attemptId
        ? await this.db
            .select()
            .from(playbackCommands)
            .where(eq(playbackCommands.attemptId, attemptId))
        : await this.db.select().from(playbackCommands);
      return rows.map((row) => row.data);
    });
  }

  snapshot(): Promise<{
    owner: PlaybackOwner | null;
    attempt: DurableAttempt | null;
    commands: DurableCommand[];
  }> {
    return databaseOperation(this.db, async () => {
      const owner =
        (
          await this.db
            .select()
            .from(playbackOwner)
            .where(eq(playbackOwner.id, 1))
        )[0]?.data ?? null;
      const attempt =
        (
          await this.db
            .select()
            .from(playbackAttempts)
            .where(eq(playbackAttempts.active, true))
        )[0]?.data ?? null;
      const commands = attempt
        ? await this.db
            .select()
            .from(playbackCommands)
            .where(eq(playbackCommands.attemptId, attempt.attemptId))
        : [];
      return { owner, attempt, commands: commands.map((row) => row.data) };
    });
  }

  claim(claim: OwnerClaim, now: number): Promise<PlaybackOwner> {
    return this.write(async (tx) => {
      const row = (
        await tx.select().from(playbackOwner).where(eq(playbackOwner.id, 1))
      )[0];
      if (!row) throw new Error("재생 소유권 저장소가 초기화되지 않았어요");
      const previous = row.data;
      if (previous && !previous.released) {
        if (
          previous.executorSessionId === claim.executorSessionId &&
          JSON.stringify(previous.connection) ===
            JSON.stringify(claim.connection)
        )
          return previous;
        throw new Error("이전 재생 기기의 정지와 해제를 먼저 확인해 주세요");
      }
      if (previous && !previous.stopConfirmed) {
        throw new Error("이전 재생 기기의 실제 정지를 확인해 주세요");
      }
      const owner: PlaybackOwner = {
        ...claim,
        ownerEpoch: row.epoch + 1,
        heartbeatAt: now,
        released: false,
        stopConfirmed: (await tx.select().from(nowPlaying)).length === 0,
      };
      await tx
        .update(playbackOwner)
        .set({
          epoch: owner.ownerEpoch,
          data: owner,
        })
        .where(eq(playbackOwner.id, 1));
      return owner;
    });
  }

  heartbeat(identity: OwnerIdentity, now: number): Promise<PlaybackOwner> {
    return this.write(async (tx) => {
      const owner = { ...(await assertOwner(tx, identity)), heartbeatAt: now };
      await tx
        .update(playbackOwner)
        .set({ data: owner })
        .where(eq(playbackOwner.id, 1));
      return owner;
    });
  }

  release(identity: OwnerIdentity): Promise<PlaybackOwner> {
    return this.write(async (tx) => {
      const owner = await assertOwner(tx, identity);
      if (!owner.stopConfirmed)
        throw new Error("실제 오디오 정지를 먼저 확인해 주세요");
      const released = { ...owner, released: true };
      await tx
        .update(playbackOwner)
        .set({ data: released })
        .where(eq(playbackOwner.id, 1));
      return released;
    });
  }

  prepare(command: DurableCommand): Promise<DurableAttempt> {
    return this.write(async (tx) => {
      const context = command.command.context;
      const attempt = await assertAttempt(tx, {
        ...context,
        ownerEpoch: command.ownerEpoch,
      });
      if (!attempt) throw new Error("재생 시도가 없어요");
      const next = { ...attempt, context };
      await tx.insert(playbackCommands).values({
        id: context.commandId,
        attemptId: context.attemptId,
        ownerEpoch: command.ownerEpoch,
        data: command,
      });
      await tx
        .update(playbackAttempts)
        .set({ data: next })
        .where(eq(playbackAttempts.id, attempt.attemptId));
      return next;
    });
  }

  setCommandState(
    fence: PlaybackFence,
    commandId: string,
    state: CommandState,
    now: number,
  ): Promise<DurableCommand> {
    return this.write(async (tx) => {
      const attempt = await assertAttempt(tx, fence);
      const row = (
        await tx
          .select()
          .from(playbackCommands)
          .where(eq(playbackCommands.id, commandId))
      )[0];
      if (
        !attempt ||
        !row ||
        row.attemptId !== attempt.attemptId ||
        row.ownerEpoch !== fence.ownerEpoch ||
        attempt.context.commandId !== commandId
      ) {
        throw new Error("오래된 재생 명령이에요");
      }
      const current = row.data;
      if (current.state === state) return current;
      // 관측이 receipt보다 먼저 오더라도 확정을 되돌리지 않아요.
      if (current.state === "confirmed" && state === "received") return current;
      const allowed: Record<CommandState, readonly CommandState[]> = {
        prepared: ["sent"],
        sent: ["received", "confirmed", "rejected", "unknown"],
        received: ["confirmed", "rejected", "unknown"],
        confirmed: [],
        rejected: [],
        unknown: ["confirmed"],
      };
      if (!allowed[current.state].includes(state))
        throw new Error("재생 명령 상태가 이미 확정됐어요");
      const next = { ...current, state, updatedAt: now };
      await tx
        .update(playbackCommands)
        .set({ data: next })
        .where(eq(playbackCommands.id, commandId));
      return next;
    });
  }

  setAttemptState(
    fence: PlaybackFence,
    state: DurableAttempt["state"],
  ): Promise<DurableAttempt> {
    return this.write(async (tx) => {
      const attempt = await assertAttempt(tx, fence);
      if (!attempt) throw new Error("재생 시도가 없어요");
      const next = { ...attempt, state };
      await tx
        .update(playbackAttempts)
        .set({ data: next })
        .where(eq(playbackAttempts.id, attempt.attemptId));
      return next;
    });
  }

  recordObservation(
    fence: PlaybackFence,
    observation: PlaybackObservation,
    state: DurableAttempt["state"],
    confirms: boolean,
    now: number,
    reconciled = false,
  ): Promise<DurableAttempt | null> {
    return this.write(async (tx) => {
      const attempt = await assertAttempt(tx, fence);
      if (
        !attempt ||
        observation.correlation?.commandId !== attempt.context.commandId ||
        observation.sequence < attempt.sequence ||
        (!reconciled && observation.sequence === attempt.sequence)
      )
        return null;
      const row = (
        await tx
          .select()
          .from(playbackCommands)
          .where(
            and(
              eq(playbackCommands.id, attempt.context.commandId),
              eq(playbackCommands.ownerEpoch, fence.ownerEpoch),
            ),
          )
      )[0];
      if (
        !row ||
        row.data.state === "prepared" ||
        row.data.state === "rejected"
      )
        return null;
      const next: DurableAttempt = {
        ...attempt,
        state,
        sequence: observation.sequence,
        binding:
          state === "reconciliation-required"
            ? attempt.binding
            : (observation.binding ?? attempt.binding),
        positionSec: observation.positionSec,
        durationSec: observation.durationSec,
        startedAt: attempt.startedAt ?? (state === "playing" ? now : null),
      };
      await tx
        .update(playbackAttempts)
        .set({ data: next })
        .where(eq(playbackAttempts.id, attempt.attemptId));
      if (next.startedAt !== null && attempt.startedAt === null) {
        await tx
          .update(nowPlaying)
          .set({ startedAt: next.startedAt })
          .where(eq(nowPlaying.id, 1));
      }
      if (confirms && row.data.state !== "confirmed") {
        await tx
          .update(playbackCommands)
          .set({
            data: { ...row.data, state: "confirmed", updatedAt: now },
          })
          .where(eq(playbackCommands.id, row.id));
      }
      return next;
    });
  }

  recover(): Promise<DurableAttempt | null> {
    return this.write(async (tx) => {
      const row = (
        await tx
          .select()
          .from(playbackAttempts)
          .where(eq(playbackAttempts.active, true))
      )[0];
      if (!row) return null;
      const attempt: DurableAttempt = {
        ...row.data,
        state: "reconciliation-required",
      };
      await tx
        .update(playbackAttempts)
        .set({ data: attempt })
        .where(eq(playbackAttempts.id, row.id));
      const commands = await tx
        .select()
        .from(playbackCommands)
        .where(eq(playbackCommands.attemptId, row.id));
      for (const command of commands) {
        if (command.data.state !== "sent" && command.data.state !== "received")
          continue;
        await tx
          .update(playbackCommands)
          .set({
            data: { ...command.data, state: "unknown" },
          })
          .where(eq(playbackCommands.id, command.id));
      }
      return attempt;
    });
  }
}
