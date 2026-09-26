import { expect, test } from "bun:test";
import { SearchService, SongLookupError } from "./search.service";

const validTrack = {
  wrapperType: "track",
  kind: "song",
  trackId: 123,
  trackName: "노래",
  artistName: "가수",
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
  trackViewUrl: "https://music.apple.com/kr/album/album/456?i=123",
  trackNumber: 2,
  trackTimeMillis: 201000,
};

function fixture(
  results: unknown[],
  onRequest?: (url: URL, signal: AbortSignal) => void,
) {
  return new SearchService(async (input, init) => {
    onRequest?.(new URL(String(input)), init?.signal as AbortSignal);
    return Response.json({ resultCount: results.length, results });
  });
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: SongLookupError["code"],
) {
  try {
    await promise;
    throw new Error("예외가 필요해요");
  } catch (error) {
    expect(error).toBeInstanceOf(SongLookupError);
    expect((error as SongLookupError).code).toBe(code);
  }
}

test("검색에서 신뢰할 수 없는 재생 URL을 제외한다", async () => {
  const service = fixture([
    { ...validTrack, trackViewUrl: "https://evil.example/album" },
  ]);
  expect(await service.search("노래")).toEqual([]);
});

test("조회는 ID만 전달하고 iTunes 원본 메타데이터를 반환한다", async () => {
  const service = fixture([validTrack], (url, signal) => {
    expect(url.origin).toBe("https://itunes.apple.com");
    expect(url.pathname).toBe("/lookup");
    expect(url.searchParams.get("id")).toBe("123");
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  expect(await service.lookup(123)).toEqual({
    trackId: 123,
    trackName: "노래",
    artistName: "가수",
    artworkUrl: "https://is1-ssl.mzstatic.com/image/300x300bb.jpg",
    albumUrl: "music://music.apple.com/kr/album/album/456",
    trackNumber: 2,
    durationSec: 201,
  });
});

test("잘못된 ID는 요청 전에 거절한다", async () => {
  const service = new SearchService(async () => {
    throw new Error("요청하면 안 돼요");
  });
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await rejectsWithCode(service.lookup(id), "invalid-track-id");
  }
});

test("조회 실패와 빈 결과를 구별한다", async () => {
  await rejectsWithCode(fixture([]).lookup(123), "not-found");
  await rejectsWithCode(
    fixture([{ ...validTrack, trackId: 124 }]).lookup(123),
    "invalid-metadata",
  );
  await rejectsWithCode(
    new SearchService(async () => new Response(null, { status: 503 })).lookup(
      123,
    ),
    "upstream-unavailable",
  );
  await rejectsWithCode(
    new SearchService(async () => {
      throw new Error("offline");
    }).lookup(123),
    "upstream-unavailable",
  );
  await rejectsWithCode(
    new SearchService(async () => new Response("{")).lookup(123),
    "upstream-unavailable",
  );
  await rejectsWithCode(
    new SearchService(async () => Response.json({ wrong: [] })).lookup(123),
    "invalid-metadata",
  );
});

test("재생 불가능하거나 조작된 메타데이터를 거절한다", async () => {
  const invalid = [
    { kind: "podcast" },
    { wrapperType: "collection" },
    { trackNumber: 0 },
    { trackNumber: 201 },
    { trackNumber: 2.5 },
    { trackTimeMillis: Infinity },
    { trackTimeMillis: -1 },
    { trackTimeMillis: 0 },
    { trackName: " " },
    { artistName: "" },
    { trackViewUrl: "http://music.apple.com/kr/album/x/456" },
    { trackViewUrl: "https://music.apple.com.evil.example/kr/album/x/456" },
    { trackViewUrl: "https://music.apple.com@evil.example/kr/album/x/456" },
    { trackViewUrl: "https://music.apple.com/kr/playlist/x/456" },
  ];
  for (const override of invalid) {
    await rejectsWithCode(
      fixture([{ ...validTrack, ...override }]).lookup(123),
      "invalid-metadata",
    );
  }
});

test("검색도 유효한 곡만 중복 없이 반환한다", async () => {
  const service = fixture([
    validTrack,
    validTrack,
    { ...validTrack, trackNumber: -1 },
    { ...validTrack, trackId: 124, kind: "podcast" },
  ]);
  expect((await service.search("노래")).map((hit) => hit.trackId)).toEqual([
    123,
  ]);
});

test("iTunes 앨범 URL도 안전한 music URL로 변환한다", async () => {
  const song = await fixture([
    {
      ...validTrack,
      trackViewUrl: "https://itunes.apple.com/us/album/test/id456?i=123#part",
    },
  ]).lookup(123);
  expect(song.albumUrl).toBe("music://itunes.apple.com/us/album/test/id456");
});
