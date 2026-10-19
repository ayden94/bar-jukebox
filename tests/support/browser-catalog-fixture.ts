import type {
  BrowserMusicProvider,
  CatalogPage,
  CatalogPort,
  MusicResult,
  ProviderIdentity,
  TrackMetadata,
} from "../../src/music/contracts";
import { createContrastingProvider } from "../../src/music/testing/contrasting-provider";
import type { SelectedBrowserFactory } from "../../src/pages/admin/music-registry";

export const catalogFixtureTracks: TrackMetadata[] = [1, 2, 3].map((index) => ({
  ref: { providerId: "youtube-music", trackId: `fixture000${index}` },
  title: `카탈로그 검증 곡 ${index}`,
  artist: "가상 자료 · 실제 YouTube Music 계정 자료 아님",
  durationSec: null,
  artwork: {
    providerId: "youtube-music",
    artworkId: `https://i.ytimg.com/vi/fixture000${index}/default.jpg`,
  },
  sourceUrl: `https://music.youtube.com/watch?v=fixture000${index}`,
}));

declare global {
  interface Window {
    __catalogFixture: {
      calls: {
        type: string;
        query?: string;
        cursor?: string | null;
        ref?: unknown;
      }[];
      running: number;
      maxRunning: number;
      aborted: number;
      commands: string[];
      disposed: boolean;
      wrongRef: boolean;
      release(): void;
    };
  }
}

// QA 전용 factory예요. 실제 확장·계정·오디오를 구현하거나 흉내 낸 제품 모드가 아니에요.
export async function loadBrowserMusicFactory(
  selected: ProviderIdentity,
  signal: AbortSignal,
): Promise<MusicResult<SelectedBrowserFactory>> {
  signal.throwIfAborted();
  if (
    selected.providerId !== "youtube-music" ||
    selected.modeId !== "browser-companion"
  )
    return { ok: false, error: { code: "configuration" } };
  return {
    ok: true,
    value: async (options, signal) => {
      signal.throwIfAborted();
      const fixture = createContrastingProvider({
        providerId: selected.providerId,
        modeId: selected.modeId,
        location: "browser",
        tracks: catalogFixtureTracks.map((track) => ({
          id: track.ref.trackId,
          title: track.title,
          artist: track.artist,
          seconds: track.durationSec,
          kind: "audio",
        })),
      });
      const releases = new Set<() => void>();
      const notify = () => window.dispatchEvent(new Event("qa-lifecycle"));
      const stats = {
        calls: [] as Window["__catalogFixture"]["calls"],
        running: 0,
        maxRunning: 0,
        aborted: 0,
        commands: [] as string[],
        disposed: false,
        wrongRef: false,
        release() {
          for (const release of [...releases]) release();
        },
      };
      window.__catalogFixture = stats;
      const port: CatalogPort = {
        async search(query, cursor, signal) {
          signal.throwIfAborted();
          stats.calls.push({ type: "search", query, cursor });
          stats.running++;
          stats.maxRunning = Math.max(stats.maxRunning, stats.running);
          notify();
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            stats.running--;
            notify();
          };
          try {
            if (query.startsWith("hold")) {
              return await new Promise<MusicResult<CatalogPage>>(
                (resolve, reject) => {
                  const cleanup = () => {
                    signal.removeEventListener("abort", abort);
                    releases.delete(release);
                  };
                  const release = () => {
                    cleanup();
                    resolve({
                      ok: true,
                      value: { tracks: [], nextCursor: null },
                    });
                  };
                  const abort = () => {
                    cleanup();
                    stats.aborted++;
                    finish();
                    notify();
                    reject(signal.reason);
                  };
                  releases.add(release);
                  signal.addEventListener("abort", abort, { once: true });
                  if (signal.aborted) abort();
                },
              );
            }
            return {
              ok: true,
              value: {
                tracks:
                  cursor === null
                    ? catalogFixtureTracks.slice(0, 2)
                    : catalogFixtureTracks.slice(2),
                nextCursor: cursor === null ? "fixture/opaque+cursor" : null,
              },
            };
          } finally {
            finish();
          }
        },
        async lookup(ref, signal) {
          signal.throwIfAborted();
          stats.calls.push({ type: "lookup", ref });
          notify();
          const track = catalogFixtureTracks.find(
            (track) => track.ref.trackId === ref.trackId,
          );
          if (!track) return { ok: false, error: { code: "invalid-track" } };
          return {
            ok: true,
            value: stats.wrongRef
              ? { ...track, ref: catalogFixtureTracks[2]!.ref }
              : track,
          };
        },
      };
      const unregister = options.registerCatalog(port);
      const provider: BrowserMusicProvider = {
        identity: fixture.provider.identity,
        auth: fixture.provider.auth,
        runtime: {
          connection: fixture.runtime.connection,
          playback: {
            ...fixture.runtime.playback,
            async execute(command, signal) {
              stats.commands.push(command.type);
              const result = await fixture.runtime.playback.execute(
                command,
                signal,
              );
              for (const sequence of fixture.controls.pendingSequences())
                fixture.controls.deliver(sequence);
              notify();
              return result;
            },
          },
        },
        async dispose() {
          unregister();
          await fixture.provider.dispose();
          stats.disposed = true;
          notify();
        },
      };
      return { ok: true, value: provider };
    },
  };
}
