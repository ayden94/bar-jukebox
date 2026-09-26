export const SEARCH_PAGE = 20;

export const art = (u: string): string =>
  u ? `/api/artwork?u=${encodeURIComponent(u)}` : u;

export function fmt(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "-:--";
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}
