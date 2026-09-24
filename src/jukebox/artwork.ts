// 앨범 커버를 서버가 대신 받아 캐시해서 제공한다.
// 손님 기기가 Apple CDN(mzstatic)에 직접 접근하지 않아도 커버가 나오도록 함.

const cache = new Map<string, { body: ArrayBuffer; contentType: string }>();
const ALLOWED_HOST = /(^|\.)mzstatic\.com$/i;
const MAX_CACHE = 200;

export type ArtworkResult = { body: ArrayBuffer; contentType: string } | null;

export async function fetchArtwork(rawUrl: string): Promise<ArtworkResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !ALLOWED_HOST.test(url.hostname)) return null;

  const hit = cache.get(rawUrl);
  if (hit) return hit;

  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const body = await res.arrayBuffer();

  if (cache.size >= MAX_CACHE) cache.clear();
  const result = { body, contentType };
  cache.set(rawUrl, result);

  return result;
}
