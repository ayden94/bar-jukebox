import type { NowPlayingView, TrackMetadata, TrackRef } from "./types";

export const playbackStatusLabel: Record<NowPlayingView["status"], string> = {
  starting: "재생 준비 중",
  playing: "재생 중",
  paused: "일시정지",
  waiting: "재생 대기 중",
  "reconciliation-required": "재생 상태 확인 필요",
};

export const trackKey = (ref: TrackRef): string =>
  JSON.stringify([ref.providerId, ref.trackId]);

export function apiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return fallback;
  }
  if (typeof body.error === "string") return body.error;
  const error = body.error;
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : fallback;
}

export const art = (artwork: TrackMetadata["artwork"]): string | undefined =>
  artwork
    ? `/api/artwork?providerId=${encodeURIComponent(artwork.providerId)}&artworkId=${encodeURIComponent(artwork.artworkId)}`
    : undefined;

export function fmt(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "-:--";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(
    2,
    "0",
  )}`;
}
