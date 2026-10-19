import type {
  CatalogPage,
  MusicError,
  MusicResult,
  TrackMetadata,
  TrackRef,
} from "../../music/contracts";
import type { BrowserCatalogFence } from "./browser-catalog-protocol";

export function catalogRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("카탈로그 메시지 형식이 올바르지 않아요");
  return value as Record<string, unknown>;
}

export function catalogText(value: unknown, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("카탈로그 문자열 범위가 올바르지 않아요");
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("카탈로그 숫자가 올바르지 않아요");
  return value;
}

export function parseCatalogFence(value: unknown): BrowserCatalogFence {
  const input = catalogRecord(value);
  const target = catalogRecord(input.target);
  const ownerEpoch = finite(input.ownerEpoch);
  if (!Number.isSafeInteger(ownerEpoch) || ownerEpoch < 1)
    throw new Error("카탈로그 owner가 올바르지 않아요");
  return {
    requestId: catalogText(input.requestId, 128),
    ownerEpoch,
    executorSessionId: catalogText(input.executorSessionId, 128),
    connectionGeneration: catalogText(input.connectionGeneration, 256),
    target: {
      providerId: catalogText(target.providerId, 128),
      modeId: catalogText(target.modeId, 128),
      targetId: catalogText(target.targetId, 512),
    },
  };
}

function error(value: unknown): MusicError {
  const input = catalogRecord(value);
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
    throw new Error("카탈로그 오류 코드가 올바르지 않아요");
  const retryAfterSec =
    input.retryAfterSec === undefined ? undefined : finite(input.retryAfterSec);
  if (retryAfterSec !== undefined && retryAfterSec > 86400)
    throw new Error("카탈로그 재시도 범위가 올바르지 않아요");
  return { code, ...(retryAfterSec === undefined ? {} : { retryAfterSec }) };
}

function track(
  value: unknown,
  providerId: string,
  expected?: TrackRef,
): TrackMetadata {
  const input = catalogRecord(value);
  const rawRef = catalogRecord(input.ref);
  const ref = {
    providerId: catalogText(rawRef.providerId, 128),
    trackId: catalogText(rawRef.trackId),
  };
  if (
    ref.providerId !== providerId ||
    (expected && ref.trackId !== expected.trackId)
  )
    throw new Error("요청한 곡과 카탈로그 응답이 달라요");
  let artwork: TrackMetadata["artwork"] = null;
  if (input.artwork !== null) {
    const raw = catalogRecord(input.artwork);
    if (raw.providerId !== providerId)
      throw new Error("커버의 음악 서비스가 달라요");
    artwork = { providerId, artworkId: catalogText(raw.artworkId, 2048) };
  }
  // URL의 공급자별 허용 목록은 공급자 포트에서 검증해요. 여기서는 fetch하지 않아요.
  const sourceUrl =
    input.sourceUrl === null ? null : catalogText(input.sourceUrl, 2048);
  if (sourceUrl !== null) {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error("곡 출처 URL이 올바르지 않아요");
  }
  return {
    ref,
    title: catalogText(input.title),
    artist: catalogText(input.artist),
    durationSec: input.durationSec === null ? null : finite(input.durationSec),
    artwork,
    sourceUrl,
  };
}

function result<T>(
  value: unknown,
  parse: (value: unknown) => T,
): MusicResult<T> {
  const input = catalogRecord(value);
  if (input.ok === false) return { ok: false, error: error(input.error) };
  if (input.ok !== true) throw new Error("카탈로그 결과가 올바르지 않아요");
  return { ok: true, value: parse(input.value) };
}

export function parseCatalogPage(
  value: unknown,
  providerId: string,
): MusicResult<CatalogPage> {
  return result(value, (value) => {
    const page = catalogRecord(value);
    if (!Array.isArray(page.tracks) || page.tracks.length > 200)
      throw new Error("카탈로그 페이지 범위가 올바르지 않아요");
    return {
      tracks: page.tracks.map((value) => track(value, providerId)),
      nextCursor:
        page.nextCursor === null ? null : catalogText(page.nextCursor, 4096),
    };
  });
}

export function parseCatalogTrack(
  value: unknown,
  ref: TrackRef,
): MusicResult<TrackMetadata> {
  return result(value, (value) => track(value, ref.providerId, ref));
}
