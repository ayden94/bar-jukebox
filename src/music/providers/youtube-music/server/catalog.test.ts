import { expect, test } from "bun:test";
import type { CatalogPort, TrackMetadata } from "../../../contracts";
import { createYouTubeCatalog } from "./catalog";
import { createYouTubeMusicServer } from "./index";

const track: TrackMetadata = {
  ref: { providerId: "youtube-music", trackId: "fixture0001" },
  title: "가상 검증 곡",
  artist: "실제 계정 자료가 아니에요",
  durationSec: null,
  artwork: {
    providerId: "youtube-music",
    artworkId: "https://i.ytimg.com/vi/fixture0001/default.jpg",
  },
  sourceUrl: "https://music.youtube.com/watch?v=fixture0001",
};
const transport: CatalogPort = {
  search: async () => ({
    ok: true,
    value: { tracks: [track], nextCursor: "server-handle" },
  }),
  lookup: async () => ({ ok: true, value: track }),
};

test("YouTube 서버 factory: relay가 있어도 사용자 인증을 만들지 않아요", async () => {
  const signal = new AbortController().signal;
  const result = await createYouTubeMusicServer({ transport }, signal);
  if (!result.ok) throw new Error("서버 provider가 필요해요");
  try {
    expect(result.value.auth.getState()).toMatchObject({
      status: "reauth-required",
      authorization: "none",
    });
    expect(await result.value.auth.connect(signal)).toEqual({
      ok: false,
      error: { code: "auth-required" },
    });
    expect(await result.value.catalog.lookup(track.ref, signal)).toEqual({
      ok: true,
      value: track,
    });
  } finally {
    await result.value.dispose();
  }
});

test("YouTube metadata: 다른 source·artwork host는 결과에 포함하지 않아요", async () => {
  for (const invalid of [
    { sourceUrl: "https://evil.test/watch?v=fixture0001" },
    { sourceUrl: "https://music.youtube.com/watch?v=other" },
    {
      artwork: {
        providerId: "youtube-music",
        artworkId: "https://i.ytimg.com.evil.test/a.jpg",
      },
    },
  ]) {
    const catalog = createYouTubeCatalog({
      ...transport,
      lookup: async () => ({ ok: true, value: { ...track, ...invalid } }),
    });
    expect(
      await catalog.catalog.lookup(track.ref, new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
    catalog.dispose();
  }
});

test("YouTube 커버: 최초 host와 redirect host를 검증하고 허용된 이미지만 반환해요", async () => {
  const fetched: string[] = [];
  const catalog = createYouTubeCatalog(transport, async (url, init) => {
    fetched.push(url);
    expect(init.redirect).toBe("manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.test/secret" },
    });
  });
  try {
    for (const artworkId of [
      "http://i.ytimg.com/a",
      "https://i.ytimg.com.evil.test/a",
      "https://user:pass@i.ytimg.com/a",
      "https://i.ytimg.com:444/a",
    ])
      expect(
        (
          await catalog.artwork.fetch(
            { providerId: "youtube-music", artworkId },
            new AbortController().signal,
          )
        ).ok,
      ).toBe(false);
    expect(fetched).toEqual([]);
    expect(
      await catalog.artwork.fetch(track.artwork!, new AbortController().signal),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
    expect(fetched).toEqual([track.artwork!.artworkId]);
  } finally {
    catalog.dispose();
  }
});
