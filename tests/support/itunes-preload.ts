// Only the spawned E2E server loads this preload. No fixture is installed in the test runner.
const tracks = [101, 102, 103, 104, 105, 106].map((trackId, index) => ({
  wrapperType: "track",
  kind: "song",
  trackId,
  trackName: `Fixture Song ${trackId}`,
  artistName: `Fixture Artist ${index}`,
  artworkUrl100: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
  trackViewUrl: `https://music.apple.com/us/album/fixture/id900?i=${trackId}`,
  trackNumber: index + 1,
  trackTimeMillis: 180000 + index * 1000,
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "is1-ssl.mzstatic.com") {
    return Promise.resolve(
      new Response(
        Bun.file(new URL("../../public/apple-touch-icon.png", import.meta.url)),
        { headers: { "Content-Type": "image/png" } },
      ),
    );
  }
  if (url.hostname !== "itunes.apple.com") return originalFetch(input, init);
  if (url.protocol !== "https:") {
    throw new Error(`Unexpected iTunes origin: ${url}`);
  }
  if (url.pathname === "/search") {
    return Promise.resolve(
      Response.json({ resultCount: tracks.length, results: tracks }),
    );
  }
  if (url.pathname === "/lookup") {
    const result = tracks.filter(
      (track) => String(track.trackId) === url.searchParams.get("id"),
    );
    return Promise.resolve(
      Response.json({ resultCount: result.length, results: result }),
    );
  }
  throw new Error(`Unexpected iTunes endpoint: ${url}`);
}) as typeof fetch;
