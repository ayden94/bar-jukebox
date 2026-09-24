import { z } from "zod";

const SearchResult = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  artworkUrl100: z.string(),
  trackViewUrl: z.string(),
  trackNumber: z.number(),
  collectionId: z.number(),
  trackTimeMillis: z.number().optional(),
});

export type SearchHit = {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl: string;
  albumUrl: string;
  trackNumber: number;
  durationSec: number | null;
};

export async function searchMusic(
  term: string,
  limit = 12,
): Promise<SearchHit[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
  const data = (await res.json()) as { results?: unknown[] };

  const hits: SearchHit[] = [];
  for (const raw of data.results ?? []) {
    const parsed = SearchResult.safeParse(raw);
    if (!parsed.success) continue;
    const r = parsed.data;
    hits.push({
      trackId: r.trackId,
      trackName: r.trackName,
      artistName: r.artistName,
      artworkUrl: r.artworkUrl100.replace("100x100bb", "300x300bb"),
      albumUrl: toAlbumUrl(r.trackViewUrl),
      trackNumber: r.trackNumber,
      durationSec:
        r.trackTimeMillis !== undefined
          ? Math.round(r.trackTimeMillis / 1000)
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
