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
  trackId?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  artworkUrl100?: unknown;
  trackViewUrl?: unknown;
  trackNumber?: unknown;
  trackTimeMillis?: unknown;
};

export async function searchMusic(
  term: string,
  limit = 200,
): Promise<SearchHit[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
  const data = (await res.json()) as { results?: RawSearchResult[] };

  const hits: SearchHit[] = [];
  const seenTrackIds = new Set<number>();
  for (const raw of data.results ?? []) {
    if (
      typeof raw.trackId !== "number" ||
      typeof raw.trackName !== "string" ||
      typeof raw.artistName !== "string" ||
      typeof raw.artworkUrl100 !== "string" ||
      typeof raw.trackViewUrl !== "string" ||
      typeof raw.trackNumber !== "number"
    ) {
      continue;
    }
    if (seenTrackIds.has(raw.trackId)) continue;
    seenTrackIds.add(raw.trackId);
    hits.push({
      trackId: raw.trackId,
      trackName: raw.trackName,
      artistName: raw.artistName,
      artworkUrl: raw.artworkUrl100.replace("100x100bb", "300x300bb"),
      albumUrl: toAlbumUrl(raw.trackViewUrl),
      trackNumber: raw.trackNumber,
      durationSec:
        typeof raw.trackTimeMillis === "number"
          ? Math.round(raw.trackTimeMillis / 1000)
          : null,
    });
  }
  return hits;
}

// music:// scheme opens the album inside Music.app and starts playback; the
// ?i= song selector is ignored by the handler, so the caller skips to the
// target track by trackNumber instead.
function toAlbumUrl(trackViewUrl: string): string {
  const withoutQuery = trackViewUrl.split("?")[0] ?? trackViewUrl;
  return withoutQuery.replace(/^https:\/\//, "music://");
}
