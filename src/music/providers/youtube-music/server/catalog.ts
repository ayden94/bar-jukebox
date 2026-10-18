import type {
  ArtworkPort,
  CatalogPort,
  TrackMetadata,
} from "../../../contracts";

export type YouTubeArtworkFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

function artworkUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return value.length <= 2048 &&
      url.protocol === "https:" &&
      ["lh3.googleusercontent.com", "i.ytimg.com"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function validTrack(track: TrackMetadata): boolean {
  if (
    track.ref.providerId !== "youtube-music" ||
    !/^[A-Za-z0-9_-]{11}$/.test(track.ref.trackId) ||
    (track.artwork !== null &&
      (track.artwork.providerId !== "youtube-music" ||
        !artworkUrl(track.artwork.artworkId)))
  )
    return false;
  if (track.sourceUrl === null) return true;
  try {
    const url = new URL(track.sourceUrl);
    return (
      url.origin === "https://music.youtube.com" &&
      url.pathname === "/watch" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.size === 1 &&
      url.searchParams.get("v") === track.ref.trackId
    );
  } catch {
    return false;
  }
}

// transport는 앱이 주입해요. 서버에는 Google 사용자 인증 자료가 없어요.
export function createYouTubeCatalog(
  transport: CatalogPort,
  fetcher: YouTubeArtworkFetch = fetch,
) {
  const lifetime = new AbortController();
  const catalog: CatalogPort = {
    async search(query, cursor, signal) {
      signal.throwIfAborted();
      const result = await transport.search(
        query,
        cursor,
        AbortSignal.any([signal, lifetime.signal]),
      );
      if (result.ok && !result.value.tracks.every(validTrack))
        return { ok: false, error: { code: "invalid-track" } };
      return result;
    },
    async lookup(ref, signal) {
      signal.throwIfAborted();
      if (
        ref.providerId !== "youtube-music" ||
        !/^[A-Za-z0-9_-]{11}$/.test(ref.trackId)
      )
        return { ok: false, error: { code: "invalid-track" } };
      const result = await transport.lookup(
        ref,
        AbortSignal.any([signal, lifetime.signal]),
      );
      if (
        result.ok &&
        (!validTrack(result.value) || result.value.ref.trackId !== ref.trackId)
      )
        return { ok: false, error: { code: "invalid-track" } };
      return result;
    },
  };
  const artwork: ArtworkPort = {
    async fetch(ref, signal) {
      signal.throwIfAborted();
      if (lifetime.signal.aborted)
        return { ok: false, error: { code: "disconnected" } };
      let url =
        ref.providerId === "youtube-music" ? artworkUrl(ref.artworkId) : null;
      if (!url) return { ok: false, error: { code: "invalid-track" } };
      const requestSignal = AbortSignal.any([
        signal,
        lifetime.signal,
        AbortSignal.timeout(5000),
      ]);
      try {
        for (let redirects = 0; redirects <= 5; redirects++) {
          const response = await fetcher(url.href, {
            redirect: "manual",
            signal: requestSignal,
          });
          requestSignal.throwIfAborted();
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            url = location ? artworkUrl(new URL(location, url).href) : null;
            if (!url) return { ok: false, error: { code: "invalid-track" } };
            continue;
          }
          const contentType = response.headers.get("content-type") ?? "";
          if (
            !response.ok ||
            !/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/i.test(contentType)
          ) {
            await response.body?.cancel();
            return { ok: false, error: { code: "unplayable" } };
          }
          const body = await response.arrayBuffer();
          requestSignal.throwIfAborted();
          return { ok: true, value: { body, contentType } };
        }
      } catch {
        signal.throwIfAborted();
      }
      return { ok: false, error: { code: "disconnected" } };
    },
  };
  return { catalog, artwork, dispose: () => lifetime.abort() };
}
