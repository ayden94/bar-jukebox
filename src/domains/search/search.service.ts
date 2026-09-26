export type SearchHit = {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
};

type RawSearchResult = {
  wrapperType?: unknown;
  kind?: unknown;
  trackId?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  artworkUrl100?: unknown;
  trackViewUrl?: unknown;
  trackNumber?: unknown;
  trackTimeMillis?: unknown;
};

type LookupErrorCode =
  | "invalid-track-id"
  | "not-found"
  | "invalid-metadata"
  | "upstream-unavailable";

export class SongLookupError extends Error {
  constructor(public readonly code: LookupErrorCode) {
    super(code);
    this.name = "SongLookupError";
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class SearchService {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async search(term: string, limit = 200): Promise<SearchHit[]> {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      term,
    )}&media=music&entity=song&limit=${limit}`;
    const res = await this.fetcher(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
    const data = (await res.json()) as { results?: RawSearchResult[] };

    const hits: SearchHit[] = [];
    const seenTrackIds = new Set<number>();
    for (const raw of data.results ?? []) {
      const hit = parseSong(raw);
      if (!hit || seenTrackIds.has(hit.trackId)) continue;
      seenTrackIds.add(hit.trackId);
      hits.push(hit);
    }
    return hits;
  }

  async lookup(trackId: number): Promise<SearchHit> {
    if (!positiveSafeInteger(trackId)) {
      throw new SongLookupError("invalid-track-id");
    }
    let data: unknown;
    try {
      const res = await this.fetcher(
        `https://itunes.apple.com/lookup?id=${trackId}&entity=song`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) throw new Error(`iTunes lookup failed: ${res.status}`);
      data = await res.json();
    } catch {
      throw new SongLookupError("upstream-unavailable");
    }
    if (
      !data ||
      typeof data !== "object" ||
      !("results" in data) ||
      !Array.isArray(data.results)
    ) {
      throw new SongLookupError("invalid-metadata");
    }
    if (data.results.length === 0) throw new SongLookupError("not-found");
    const raw = data.results.find(
      (result: unknown) =>
        result &&
        typeof result === "object" &&
        "trackId" in result &&
        result.trackId === trackId,
    );
    if (!raw) throw new SongLookupError("invalid-metadata");
    const hit = parseSong(raw);
    if (!hit) throw new SongLookupError("invalid-metadata");
    return hit;
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseSong(value: unknown): SearchHit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawSearchResult;
  if (
    raw.wrapperType !== "track" ||
    raw.kind !== "song" ||
    !positiveSafeInteger(raw.trackId) ||
    typeof raw.trackName !== "string" ||
    !raw.trackName.trim() ||
    typeof raw.artistName !== "string" ||
    !raw.artistName.trim() ||
    typeof raw.artworkUrl100 !== "string" ||
    typeof raw.trackViewUrl !== "string" ||
    !positiveSafeInteger(raw.trackNumber) ||
    raw.trackNumber > 200 ||
    typeof raw.trackTimeMillis !== "number" ||
    !Number.isFinite(raw.trackTimeMillis) ||
    raw.trackTimeMillis <= 0
  )
    return null;
  const albumUrl = toAlbumUrl(raw.trackViewUrl);
  if (!albumUrl) return null;
  const durationSec = Math.round(raw.trackTimeMillis / 1000);
  if (!Number.isSafeInteger(durationSec) || durationSec <= 0) return null;
  return {
    trackId: raw.trackId,
    trackName: raw.trackName,
    artistName: raw.artistName,
    artworkUrl: raw.artworkUrl100.replace("100x100bb", "300x300bb"),
    albumUrl,
    trackNumber: raw.trackNumber,
    durationSec,
  };
}

// Music.app은 ?i= 곡 선택을 무시하므로 앨범을 열고 trackNumber만큼 이동한다.
function toAlbumUrl(trackViewUrl: string): string | null {
  try {
    const url = new URL(trackViewUrl);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "music.apple.com" &&
        url.hostname !== "itunes.apple.com") ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/[a-z]{2}(?:-[a-z]{2})?\/album\/[^/]+\/(?:id)?\d+\/?$/i.test(
        url.pathname,
      )
    )
      return null;
    return `music://${url.hostname}${url.pathname}`;
  } catch {
    return null;
  }
}
