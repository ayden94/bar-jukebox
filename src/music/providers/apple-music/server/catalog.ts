import type {
  ArtworkPort,
  CatalogPort,
  MusicResult,
  TrackMetadata,
  TrackRef,
} from "../../../contracts/index";

export type AppleFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PreparedTrack = {
  metadata: TrackMetadata;
  albumUrl: string;
  album: string;
  trackNumber: number;
  discNumber: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function artworkUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      /(^|\.)mzstatic\.com$/i.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
      ? url
      : null;
  } catch {
    return null;
  }
}

function parseTrack(raw: unknown): PreparedTrack | null {
  if (
    !record(raw) ||
    raw.wrapperType !== "track" ||
    raw.kind !== "song" ||
    !positiveInteger(raw.trackId) ||
    typeof raw.trackName !== "string" ||
    !raw.trackName.trim() ||
    typeof raw.artistName !== "string" ||
    !raw.artistName.trim() ||
    (raw.collectionName !== undefined &&
      (typeof raw.collectionName !== "string" || !raw.collectionName.trim())) ||
    typeof raw.trackViewUrl !== "string" ||
    !positiveInteger(raw.trackNumber) ||
    raw.trackNumber > 200 ||
    (raw.trackTimeMillis !== undefined &&
      raw.trackTimeMillis !== null &&
      (typeof raw.trackTimeMillis !== "number" ||
        !Number.isFinite(raw.trackTimeMillis) ||
        raw.trackTimeMillis <= 0)) ||
    (raw.discNumber !== undefined && !positiveInteger(raw.discNumber))
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trackViewUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !["music.apple.com", "itunes.apple.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/[a-z]{2}(?:-[a-z]{2})?\/album\/[^/]+\/(?:id)?\d+\/?$/i.test(
      url.pathname,
    )
  ) {
    return null;
  }
  const artwork =
    typeof raw.artworkUrl100 === "string"
      ? artworkUrl(raw.artworkUrl100.replace("100x100bb", "300x300bb"))
      : null;
  return {
    metadata: {
      ref: { providerId: "apple-music", trackId: String(raw.trackId) },
      title: raw.trackName,
      artist: raw.artistName,
      durationSec:
        typeof raw.trackTimeMillis === "number" &&
        Number.isFinite(raw.trackTimeMillis) &&
        raw.trackTimeMillis > 0
          ? raw.trackTimeMillis / 1000
          : null,
      artwork: artwork
        ? { providerId: "apple-music", artworkId: artwork.href }
        : null,
      sourceUrl: url.href,
    },
    albumUrl: `music://${url.hostname}${url.pathname}`,
    album: typeof raw.collectionName === "string" ? raw.collectionName : "",
    trackNumber: raw.trackNumber,
    discNumber: typeof raw.discNumber === "number" ? raw.discNumber : 1,
  };
}

// 매장 계정의 storefront와 같은 국가로 조회해야 Music.app과 곡 정보가 맞아요.
export function createAppleCatalog(fetcher: AppleFetch, country?: string) {
  const storefront =
    country && /^[a-z]{2}$/i.test(country)
      ? `&country=${country.toLowerCase()}`
      : "";
  const prepared = new Map<string, PreparedTrack>();
  const artworkCache = new Map<
    string,
    { body: ArrayBuffer; contentType: string }
  >();
  const lifetime = new AbortController();

  async function request(
    url: string,
    signal: AbortSignal,
  ): Promise<MusicResult<readonly unknown[]>> {
    signal.throwIfAborted();
    if (lifetime.signal.aborted) {
      return { ok: false, error: { code: "disconnected" } };
    }
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.any([
          signal,
          lifetime.signal,
          AbortSignal.timeout(5000),
        ]),
        redirect: "error",
      });
      signal.throwIfAborted();
      if (lifetime.signal.aborted) {
        return { ok: false, error: { code: "disconnected" } };
      }
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
        return {
          ok: false,
          error: {
            code: "rate-limited",
            ...(seconds !== null && Number.isFinite(seconds)
              ? { retryAfterSec: seconds }
              : {}),
          },
        };
      }
      if (!response.ok) {
        return { ok: false, error: { code: "disconnected" } };
      }
      const body: unknown = await response.json();
      signal.throwIfAborted();
      if (lifetime.signal.aborted) {
        return { ok: false, error: { code: "disconnected" } };
      }
      if (!record(body) || !Array.isArray(body.results)) {
        return { ok: false, error: { code: "unplayable" } };
      }
      return { ok: true, value: body.results };
    } catch {
      signal.throwIfAborted();
      return { ok: false, error: { code: "disconnected" } };
    }
  }

  async function resolve(
    ref: TrackRef,
    signal: AbortSignal,
  ): Promise<MusicResult<PreparedTrack>> {
    signal.throwIfAborted();
    if (ref.providerId !== "apple-music" || !/^[1-9]\d*$/.test(ref.trackId)) {
      return { ok: false, error: { code: "invalid-track" } };
    }
    if (lifetime.signal.aborted) {
      return { ok: false, error: { code: "disconnected" } };
    }
    const cached = prepared.get(ref.trackId);
    if (cached) {
      return { ok: true, value: cached };
    }
    const response = await request(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(ref.trackId)}&entity=song${storefront}`,
      signal,
    );
    if (!response.ok) {
      return response;
    }
    const track = response.value
      .map(parseTrack)
      .find((item) => item?.metadata.ref.trackId === ref.trackId);
    if (!track) {
      return { ok: false, error: { code: "invalid-track" } };
    }
    if (prepared.size >= 400) {
      prepared.clear();
    }
    prepared.set(ref.trackId, track);
    return { ok: true, value: track };
  }

  const catalog: CatalogPort = {
    async search(query, cursor, signal) {
      signal.throwIfAborted();
      // iTunes 검색은 최대 200개짜리 단일 페이지예요.
      if (cursor !== null) {
        return { ok: false, error: { code: "unsupported" } };
      }
      const response = await request(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=200${storefront}`,
        signal,
      );
      if (!response.ok) {
        return response;
      }
      const tracks = new Map<string, TrackMetadata>();
      for (const raw of response.value) {
        const track = parseTrack(raw);
        if (track) {
          tracks.set(track.metadata.ref.trackId, track.metadata);
        }
      }
      return {
        ok: true,
        value: { tracks: [...tracks.values()], nextCursor: null },
      };
    },
    async lookup(ref, signal) {
      const resolved = await resolve(ref, signal);
      return resolved.ok
        ? { ok: true, value: resolved.value.metadata }
        : resolved;
    },
  };

  const artwork: ArtworkPort = {
    async fetch(ref, signal) {
      signal.throwIfAborted();
      if (lifetime.signal.aborted) {
        return { ok: false, error: { code: "disconnected" } };
      }
      let url =
        ref.providerId === "apple-music" ? artworkUrl(ref.artworkId) : null;
      if (!url) {
        return { ok: false, error: { code: "invalid-track" } };
      }
      const cached = artworkCache.get(ref.artworkId);
      if (cached) {
        return { ok: true, value: { ...cached, body: cached.body.slice(0) } };
      }
      const requestSignal = AbortSignal.any([
        signal,
        lifetime.signal,
        AbortSignal.timeout(5000),
      ]);
      try {
        for (let redirects = 0; redirects <= 5; redirects += 1) {
          const response = await fetcher(url.href, {
            redirect: "manual",
            signal: requestSignal,
          });
          signal.throwIfAborted();
          if (lifetime.signal.aborted) {
            await response.body?.cancel();
            return { ok: false, error: { code: "disconnected" } };
          }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            url = location ? artworkUrl(new URL(location, url).href) : null;
            if (!url) {
              return { ok: false, error: { code: "invalid-track" } };
            }
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
          signal.throwIfAborted();
          if (lifetime.signal.aborted) {
            return { ok: false, error: { code: "disconnected" } };
          }
          if (artworkCache.size >= 200) {
            artworkCache.clear();
          }
          artworkCache.set(ref.artworkId, { body, contentType });
          return { ok: true, value: { body: body.slice(0), contentType } };
        }
      } catch {
        signal.throwIfAborted();
      }
      return { ok: false, error: { code: "disconnected" } };
    },
  };

  return {
    catalog,
    resolve,
    artwork,
    dispose() {
      lifetime.abort();
      prepared.clear();
      artworkCache.clear();
    },
  };
}
