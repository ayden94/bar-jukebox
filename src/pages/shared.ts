export const SEARCH_PAGE = 20;

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

export const art = (u: string): string =>
  u ? `/api/artwork?u=${encodeURIComponent(u)}` : u;

export function fmt(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "-:--";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(
    2,
    "0",
  )}`;
}
