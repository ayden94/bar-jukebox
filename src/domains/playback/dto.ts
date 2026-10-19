import {
  BadRequestException,
  FromBody,
  FromQuery,
  Optional,
} from "@fluojs/http";
import { IsInt, IsObject, IsString } from "@fluojs/validation";
import type {
  CommandOutcome,
  ConnectedTarget,
  JsonValue,
  MusicError,
  MusicResult,
  NativeBinding,
  PlaybackContext,
  PlaybackObservation,
  PlaybackTarget,
  Reconciliation,
} from "../../music/contracts";
import type { BrowserStoppedFence } from "./protocol";

export class ConfirmBrowserStoppedDto {
  @IsInt()
  @FromBody("ownerEpoch")
  ownerEpoch = 0;
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
  @FromBody("attemptId")
  attemptId: unknown;
  @FromBody("songId")
  songId: unknown;
}

export class PlaybackEventsDto {
  @Optional()
  @IsString()
  @FromQuery("executorSessionId")
  executorSessionId = "";
}

export class ClaimOwnerDto {
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
  @IsObject()
  @FromBody("connection")
  connection: unknown = null;
}

export class OwnerIdentityDto {
  @IsInt()
  @FromBody("ownerEpoch")
  ownerEpoch = 0;
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
}

export class PlaybackReceiptDto {
  @IsInt()
  @FromBody("ownerEpoch")
  ownerEpoch = 0;
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
  @IsObject()
  @FromBody("outcome")
  outcome: unknown = null;
}

export class PlaybackObservationDto {
  @IsInt()
  @FromBody("ownerEpoch")
  ownerEpoch = 0;
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
  @IsObject()
  @FromBody("observation")
  observation: unknown = null;
}

export class PlaybackReconciliationDto {
  @IsInt()
  @FromBody("ownerEpoch")
  ownerEpoch = 0;
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
  @IsString()
  @FromBody("requestId")
  requestId = "";
  @IsObject()
  @FromBody("result")
  result: unknown = null;
}

function invalid(): never {
  throw new BadRequestException("재생 메시지 형식이 올바르지 않아요");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) invalid();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    invalid();
  return value;
}

function integer(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result)) invalid();
  return result;
}

export function parseBrowserStoppedFence(value: unknown): BrowserStoppedFence {
  const input = record(value);
  const ownerEpoch = integer(input.ownerEpoch);
  if (ownerEpoch === 0) invalid();
  const attemptId = input.attemptId === null ? null : text(input.attemptId);
  const songId = input.songId === null ? null : text(input.songId);
  if ((attemptId === null) !== (songId === null)) invalid();
  return {
    ownerEpoch,
    executorSessionId: text(input.executorSessionId),
    attemptId,
    songId,
  };
}

function target(value: unknown): PlaybackTarget {
  const input = record(value);
  return {
    providerId: text(input.providerId),
    modeId: text(input.modeId),
    targetId: text(input.targetId),
  };
}

function context(value: unknown): PlaybackContext {
  const input = record(value);
  return {
    commandId: text(input.commandId),
    attemptId: text(input.attemptId),
    executorSessionId: text(input.executorSessionId),
    target: target(input.target),
    connectionGeneration: text(input.connectionGeneration),
  };
}

export function parseConnection(value: unknown): ConnectedTarget {
  const input = record(value);
  if (input.location !== "browser") invalid();
  const capabilities = record(input.capabilities);
  const capability = (key: string): boolean => {
    const value = capabilities[key];
    if (typeof value !== "boolean") invalid();
    return value;
  };
  return {
    target: target(input.target),
    connectionGeneration: text(input.connectionGeneration),
    location: "browser",
    capabilities: {
      canPlayExactTrack: capability("canPlayExactTrack"),
      canPause: capability("canPause"),
      canResume: capability("canResume"),
      canStop: capability("canStop"),
      canRestart: capability("canRestart"),
      canObserveEnd: capability("canObserveEnd"),
      canSeek: capability("canSeek"),
    },
  };
}

function musicError(value: unknown): MusicError {
  const input = record(value);
  const code = input.code;
  if (
    code !== "invalid-track" &&
    code !== "unplayable" &&
    code !== "auth-required" &&
    code !== "permission-denied" &&
    code !== "disconnected" &&
    code !== "rate-limited" &&
    code !== "unsupported" &&
    code !== "configuration" &&
    code !== "unknown-outcome"
  )
    invalid();
  return {
    code,
    ...(input.retryAfterSec === undefined
      ? {}
      : { retryAfterSec: number(input.retryAfterSec) }),
  };
}

export function parseOutcome(value: unknown): CommandOutcome {
  const input = record(value);
  const correlation = context(input.context);
  if (input.status === "accepted")
    return { status: "accepted", context: correlation };
  const error = musicError(input.error);
  if (input.status === "unknown" && error.code === "unknown-outcome") {
    return {
      status: "unknown",
      context: correlation,
      error: { ...error, code: "unknown-outcome" },
    };
  }
  if (input.status === "rejected" && error.code !== "unknown-outcome") {
    return {
      status: "rejected",
      context: correlation,
      error: { ...error, code: error.code },
    };
  }
  return invalid();
}

function json(value: unknown, depth = 0): JsonValue {
  if (depth > 32) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => json(entry, depth + 1));
  const input = record(value);
  return Object.fromEntries(
    Object.entries(input).map(([key, entry]) => [key, json(entry, depth + 1)]),
  );
}

function binding(value: unknown): NativeBinding {
  const input = record(value);
  const version = integer(input.version);
  if (version === 0) invalid();
  return {
    providerId: text(input.providerId),
    modeId: text(input.modeId),
    version,
    payload: json(input.payload),
  };
}

export function parseObservation(value: unknown): PlaybackObservation {
  const input = record(value);
  const state = input.state;
  if (
    state !== "playing" &&
    state !== "paused" &&
    state !== "stopped" &&
    state !== "buffering" &&
    state !== "interrupted" &&
    state !== "ended" &&
    state !== "unavailable" &&
    state !== "unknown"
  )
    invalid();
  const track = input.trackRef === null ? null : record(input.trackRef);
  const correlation =
    input.correlation === null ? null : record(input.correlation);
  const common = {
    trackRef: track
      ? { providerId: text(track.providerId), trackId: text(track.trackId) }
      : null,
    target: input.target === null ? null : target(input.target),
    connectionGeneration:
      input.connectionGeneration === null
        ? null
        : text(input.connectionGeneration),
    correlation: correlation
      ? {
          commandId: text(correlation.commandId),
          attemptId: text(correlation.attemptId),
          executorSessionId: text(correlation.executorSessionId),
        }
      : null,
    binding: input.binding === null ? null : binding(input.binding),
    sequence: integer(input.sequence),
    positionSec: input.positionSec === null ? null : number(input.positionSec),
    durationSec: input.durationSec === null ? null : number(input.durationSec),
  };
  if (state === "ended") {
    if (
      input.endReason !== "natural-end" &&
      input.endReason !== "owned-advance" &&
      input.endReason !== "replaced"
    )
      invalid();
    return { ...common, state, endReason: input.endReason };
  }
  if (input.endReason !== undefined) invalid();
  return { ...common, state };
}

export function parseReconciliation(
  value: unknown,
): MusicResult<Reconciliation> {
  const input = record(value);
  if (input.ok === false) return { ok: false, error: musicError(input.error) };
  if (input.ok !== true) invalid();
  const result = record(input.value);
  if (result.status === "unknown")
    return { ok: true, value: { status: "unknown" } };
  if (result.status !== "match" && result.status !== "mismatch") invalid();
  return {
    ok: true,
    value: {
      status: result.status,
      observation: parseObservation(result.observation),
    },
  };
}
