import type {
  ArtworkPort,
  ArtworkRef,
  CatalogPort,
  TrackMetadata,
  TrackRef,
} from "../../music/contracts";

export type SearchHit = TrackMetadata;

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

export class SearchService {
  constructor(
    private readonly catalog: CatalogPort,
    private readonly artwork: ArtworkPort,
    readonly providerId: string,
  ) {}

  async search(query: string, cursor: string | null = null) {
    const result = await this.catalog.search(
      query,
      cursor,
      AbortSignal.timeout(5000),
    );
    if (!result.ok) throw new SongLookupError("upstream-unavailable");
    return { hits: result.value.tracks, nextCursor: result.value.nextCursor };
  }

  async lookup(ref: TrackRef): Promise<TrackMetadata> {
    if (
      ref.providerId !== this.providerId ||
      !ref.trackId ||
      !ref.trackId.trim()
    ) {
      throw new SongLookupError("invalid-track-id");
    }
    const result = await this.catalog.lookup(ref, AbortSignal.timeout(5000));
    if (!result.ok) {
      throw new SongLookupError(
        result.error.code === "invalid-track" ||
          result.error.code === "unplayable"
          ? "not-found"
          : "upstream-unavailable",
      );
    }
    if (
      result.value.ref.providerId !== ref.providerId ||
      result.value.ref.trackId !== ref.trackId
    ) {
      throw new SongLookupError("invalid-metadata");
    }
    return result.value;
  }

  async fetchArtwork(ref: ArtworkRef) {
    if (ref.providerId !== this.providerId) return null;
    const result = await this.artwork.fetch(ref, AbortSignal.timeout(5000));
    return result.ok ? result.value : null;
  }
}
