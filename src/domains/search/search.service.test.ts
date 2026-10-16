import { expect, test } from "bun:test";
import type {
  ArtworkPort,
  CatalogPort,
  TrackMetadata,
} from "../../music/contracts";
import { SearchService } from "./search.service";

const track: TrackMetadata = {
  ref: { providerId: "fixture", trackId: "Case/001" },
  title: "곡",
  artist: "가수",
  durationSec: null,
  artwork: null,
  sourceUrl: null,
};
const artwork: ArtworkPort = {
  fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
};
function fixture(overrides: Partial<CatalogPort> = {}) {
  const catalog: CatalogPort = {
    search: async () => ({
      ok: true,
      value: { tracks: [track], nextCursor: "opaque" },
    }),
    lookup: async () => ({ ok: true, value: track }),
    ...overrides,
  };
  return new SearchService(catalog, artwork, "fixture");
}

test("문자열 식별자와 알 수 없는 길이를 그대로 조회해요", async () => {
  const service = fixture({
    lookup: async (ref, signal) => {
      expect(ref).toEqual(track.ref);
      expect(signal).toBeInstanceOf(AbortSignal);
      return { ok: true, value: track };
    },
  });
  expect(await service.lookup(track.ref)).toEqual(track);
});

test("공급자와 빈 식별자는 외부 조회 전에 거절해요", async () => {
  const service = fixture({
    lookup: async () => {
      throw new Error("호출하면 안 돼요");
    },
  });
  for (const ref of [
    { providerId: "other", trackId: "Case/001" },
    { providerId: "fixture", trackId: "" },
  ]) {
    await expect(service.lookup(ref)).rejects.toMatchObject({
      code: "invalid-track-id",
    });
  }
});

test("조회한 곡이 다른 식별자이면 거절해요", async () => {
  await expect(
    fixture().lookup({ ...track.ref, trackId: "case/001" }),
  ).rejects.toMatchObject({ code: "invalid-metadata" });
});

test("재생 불가와 연결 실패를 구분해요", async () => {
  for (const code of ["invalid-track", "unplayable", "disconnected"] as const) {
    const service = fixture({
      lookup: async () => ({ ok: false, error: { code } }),
    });
    await expect(service.lookup(track.ref)).rejects.toMatchObject({
      code: code === "disconnected" ? "upstream-unavailable" : "not-found",
    });
  }
});

test("검색 페이지와 cursor를 공급자 계약 그대로 전달해요", async () => {
  const service = fixture({
    search: async (query, cursor) => {
      expect(query).toBe("곡");
      expect(cursor).toBe("opaque:next");
      return { ok: true, value: { tracks: [track], nextCursor: null } };
    },
  });
  expect(await service.search("곡", "opaque:next")).toEqual({
    hits: [track],
    nextCursor: null,
  });
});

test("다른 공급자 커버는 조회하지 않아요", async () => {
  const service = new SearchService(
    {
      search: async () => ({
        ok: true,
        value: { tracks: [], nextCursor: null },
      }),
      lookup: async () => ({ ok: true, value: track }),
    },
    {
      fetch: async () => {
        throw new Error("호출하면 안 돼요");
      },
    },
    "fixture",
  );
  expect(
    await service.fetchArtwork({ providerId: "other", artworkId: "x" }),
  ).toBeNull();
});
