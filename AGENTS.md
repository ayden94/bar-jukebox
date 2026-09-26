# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-26
**Commit:** 9095244
**Branch:** main

## OVERVIEW
Bar jukebox: guests scan a table QR and request songs from their phone; the bar's Mac plays them in order through Apple Music (Music.app driven by osascript). Full-stack on the in-house `fluo` framework (`@fluojs/*`: DI controllers, DTO validation, SSE, React SSR) on Bun, built by two Vite configs (client + server SSR). UI text and comments are Korean.

## STRUCTURE
```
.
├── src/main.ts         # server boot: SQLite hydrate, client-manifest load, FluoFactory, playback loop
├── src/app.tsx         # JukeboxModule wiring: controllers, providers, middleware, React page routers
├── src/domains/        # domain layer: queue/table/settings/search/playback/events/admin as controller→service→repository; shared = bus/types/config
├── src/infra/          # db.ts (libsql client) + schema.ts (drizzle schema, SCHEMA_DDL)
├── src/middleware/     # device identity cookie (bj_did)
├── src/pages/          # React UI: guest + admin sub-apps, SSR/hydration entries, shared hooks/theme
├── public/             # legacy pre-React HTML shells (copied to dist/client by Vite default publicDir)
├── docs/               # plan docs: local PoC, fluo migration (done), cloud SaaS track (future)
└── test-flow.ts        # live end-to-end API flow against a running server
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/modify an API route | src/domains/<domain>/<domain>.controller.ts | @Get/@Post + @RequestDto; DTO in the domain's dto.ts |
| Queue/state rules | src/domains/queue/queue.service.ts | per-device/per-table song caps (settings-backed, default 1/5), no duplicate track, own-cancel-only |
| Persistence / schema | src/infra/ + src/domains/*/repository.ts | drizzle-orm/libsql over @libsql/client (async); incremental per-mutation writes via repositories |
| Music playback | src/domains/playback/playback.service.ts | osascript Music.app; mute → album-skip trick |
| Song search | src/domains/search/search.service.ts | iTunes Search API → `music://` album URLs |
| SSE realtime | src/domains/events/events.controller.ts | bus "mutate"/"progress" → snapshot broadcast, 25s ping |
| Admin auth | src/domains/admin/admin-token.guard.ts | x-admin-token header vs .env ADMIN_TOKEN |
| Guest identity | src/middleware/device-cookie.middleware.ts | httpOnly cookie bj_did, 1 year |
| DI providers | src/domains/providers.ts | domain singletons wrapped as fluo providers |
| UI data hooks | src/pages/hooks.ts | SSE snapshot + polling fallback, toast, infinite scroll |

## CODE MAP
(grep + full-read derived; LSP/ast-grep unavailable at generation time)

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| queueService (QueueService) | singleton | src/domains/queue/queue.service.ts | ~6 files | in-memory queue/history/now-playing + rules; persists per mutation |
| jukeboxProviders | const | src/domains/providers.ts | 4 files | domain singleton → fluo provider mapping |
| PlaybackService.start | method | src/domains/playback/playback.service.ts | main.ts | sequential Music.app playback loop |
| QueueRepository 등 레포지토리 | class | src/domains/*/repository.ts | services | incremental SQLite writes; queue writes serialized via writeChain |
| onChange / emit | fn | src/domains/shared/bus.ts | services, events ctrl | mutate/progress event bus |
| SearchService | class | src/domains/search/search.service.ts | search ctrl | iTunes search, music:// URL builder |
| SseBroker | class | src/domains/events/sse-broker.ts | events ctrl | wakes all SSE waiters on change |
| fetchArtwork | fn | src/domains/search/artwork.ts | search ctrl | mzstatic-only artwork proxy cache |
| GuestPageRouter / AdminPageRouter | class | src/app.tsx | ReactModule | SSR pages at / and /admin |

## CONVENTIONS
- fluo decorators on the server: @Module/@Inject/@Controller/@Router/@Get/@Post/@Delete/@Sse/@UseGuards; DTO classes validated via @IsXxx + @FromBody/@FromQuery/@FromCookie/@FromPath.
- src/domains services/repositories stay framework-agnostic pure TS; only controllers and providers.ts import @fluojs/*.
- File suffixes encode role: .controller.ts, .guard.ts, .middleware.ts, .test.ts colocated with source.
- Strict TS: noUncheckedIndexedAccess, noImplicitOverride; Biome recommended preset, 2-space, noNonNullAssertion off.
- User-facing strings, comments, test names, and README are Korean (polite "~해요" tone) — keep it.
- bun:test with Korean test names; service tests inject an in-memory repository fake, repository tests run against a real :memory: SQLite.

## ANTI-PATTERNS (THIS PROJECT)
- NEVER inherit DTO classes: field metadata binds to the parent class — flatten fields instead (see dto.ts note).
- Never import @fluojs/* in src/domains service/repository files — controllers and providers.ts are the only seams.
- @babel/core must stay v7 (v8 removes allowDeclareFields and breaks fluo's babel config); Babel 8 would require fluoDecoratorsPlugin({ babelConfigFile }) with a filesystem path — file:// URLs fail.
- Never restart a now-playing song restored from SQLite after a server restart — the loop waits for it to end.
- Never let guest devices hit Apple CDN directly; artwork goes through /api/artwork (mzstatic-only allowlist).
- Never bypass the state rules in controllers — they live in queue.service.ts and are test-enforced.
- Never commit jukebox.sqlite*, dist/, .env — gitignored runtime artifacts.

## UNIQUE STYLES
- Playback hack: Music.app ignores the `?i=` selector on music:// URLs, so playSong mutes the volume, opens the whole album, `next track`-skips to the target trackNumber, then restores volume; waitForTrackEnd watches the current track id to cut off album auto-advance.
- Page selection over SSR + hydration via `<html data-page>` dataset; hydration options from createReactViteAssetManifest.
- Admin is split into per-route page documents (AdminSongsDocument / AdminQrDocument; entry-client picks by data-page; /admin 302 → /admin/songs); admin token cached in localStorage (bj_admin), sent as x-admin-token.

## COMMANDS
```bash
bun install
bun run dev            # fluo dev
bun run build          # vite client build, then vite server build (both required)
bun start              # bun dist/server/main.js (needs client build first)
bun test               # unit tests (bun:test, src/domains/**/*.test.ts)
bun run typecheck      # bunx tsc --noEmit
bun run check          # bunx biome check src test-flow.ts
ADMIN_TOKEN=<token> bun test-flow.ts   # live API flow vs running server
```

## NOTES
- Boot order: the client build must exist (dist/client/.vite/manifest.json) or main.ts throws.
- Every mutation persists through its domain repository (fire-and-forget, writeChain-serialized); bus "mutate" now only wakes SSE. Restart restores the queue and waits out the in-flight song.
- PORT comes from .env (default 5173); BASE_URL (or LAN-IP autodetect) is baked into printed QR URLs — changing the host invalidates printed QRs; fixed hostname (mDNS) recommended.
- public/*.html are the legacy pre-React shells still copied into dist/client; the live app serves React documents instead.
- docs/plan-cloud.md fixes a hard constraint for the future SaaS track: Apple Music cannot play from a cloud server — playback must stay on a venue-local device.
