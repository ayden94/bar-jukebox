import { expect, test } from "bun:test";
import type { CatalogPort, TrackMetadata } from "../../music/contracts";
import { SearchQueryDto } from "./dto";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

test("검색 컨트롤러는 cursor 생략과 빈 문자열 다음 페이지를 구분해요", async () => {
  const received: (string | null)[] = [];
  const track = (id: string): TrackMetadata => ({
    ref: { providerId: "fixture", trackId: id },
    title: id,
    artist: "가수",
    artwork: null,
    sourceUrl: null,
    durationSec: null,
  });
  const catalog: CatalogPort = {
    async search(_query, cursor) {
      received.push(cursor);
      return {
        ok: true,
        value: {
          tracks: [track(cursor === null ? "first" : "second")],
          nextCursor: cursor === null ? "" : null,
        },
      };
    },
    lookup: async () => ({ ok: false, error: { code: "invalid-track" } }),
  };
  const controller = new SearchController(
    new SearchService(
      catalog,
      {
        fetch: async () => ({ ok: false, error: { code: "invalid-track" } }),
      },
      "fixture",
    ),
  );
  const query = new SearchQueryDto();
  query.q = "곡";
  const first = await controller.searchSongs(query);
  expect(first.hits[0]?.ref.trackId).toBe("first");
  expect(first.nextCursor).toBe("");
  if (first.nextCursor === null) throw new Error("다음 cursor가 필요해요");
  query.cursor = first.nextCursor;
  const second = await controller.searchSongs(query);
  expect(second.hits[0]?.ref.trackId).toBe("second");
  expect(second.nextCursor).toBeNull();
  expect(received).toEqual([null, ""]);
});
