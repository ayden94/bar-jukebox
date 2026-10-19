# PROJECT KNOWLEDGE BASE

**Updated:** 2026-10-19
**Commit:** d64b995
**Branch:** main

## OVERVIEW
Bar jukebox: guests scan a table QR and request songs from their phone; a venue-local playback executor plays them in order. Music access goes through a provider-neutral contract (src/music). The registry lists Apple Music (`applescript`, `musickit`) and YouTube Music (`browser-companion`), but only Apple Music `applescript` (Music.app via osascript on the bar's Mac) is offered today; the rest show as "지원 예정" (src/music/availability.ts) while their adapters and tests stay in the tree. Full-stack on the in-house `fluo` framework (`@fluojs/*`: DI controllers, DTO validation, SSE, React SSR/navigation) on Bun, built by two Vite configs (client + server SSR). UI text and comments are Korean.

Subdirectory guides win for their trees: src/domains/AGENTS.md, src/pages/AGENTS.md.

## STRUCTURE
```
.
├── src/main.ts         # boot: DB init/migrate, createJukeboxRuntime, client manifest, FluoFactory, CSP, playback loop
├── src/app.tsx         # createJukeboxModule: controllers, providers, middleware, page routers, /assets
├── src/domains/        # controller→service→repository per domain: queue/table/settings/search/playback/music/events/admin; shared = bus/types/config/state-view
├── src/music/          # contracts, registry (lazy provider loading), Apple Music (server + MusicKit browser) and YouTube Music providers, conformance kit
├── src/infra/          # db.ts (libsql), schema.ts, migrations.ts (SCHEMA_VERSION), backup.ts
├── src/middleware/     # signed device identity cookie (bj_did)
├── src/pages/          # React UI: guest + admin (songs/qr/music) pages, SSR/hydration entries, hooks/theme
├── tests/              # browser/E2E scripts + support (isolated server, iTunes fixture preload)
├── extensions/         # youtube-music/probe: dev-only YouTube Music page probe + observation contract
├── scripts/            # backup-database.ts (consistent SQLite backup)
├── public/             # static assets + legacy pre-React HTML shells (copied to dist/client)
├── docs/               # plan docs: local PoC, fluo migration (done), cloud SaaS track (future)
├── DESIGN.md           # UI design notes
└── test-flow.ts        # live end-to-end API flow against a running server
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/modify an API route | src/domains/<domain>/<domain>.controller.ts | @Get/@Post + @RequestDto; DTO in the domain's dto.ts |
| Runtime wiring | src/domains/providers.ts | createJukeboxRuntime builds every service, resolves the music provider, hydrates state |
| Queue/state rules | src/domains/queue/queue.service.ts | per-device/per-table caps (settings-backed, default 1/5), no duplicate track, own-cancel-only, provider-conflict guard |
| Playback protocol | src/domains/playback/ (protocol.ts, playback.service.ts) | durable owner epoch + attempts + commands; server port or BrowserPlaybackBridge |
| Music provider choice | src/domains/music/ (music-config.ts) | env > admin-saved next-boot config > macOS default; env-set fields lock in admin UI; restart to apply |
| Provider contracts | src/music/contracts/ | catalog/auth/connection/playback ports, MusicResult errors |
| Provider registry / availability | src/music/registry.ts, src/music/availability.ts | descriptors are pure values; implementations load via dynamic import only for the selected mode |
| Apple Music implementation | src/music/providers/apple-music/ | server/: catalog.ts (iTunes), native.ts + playback.ts (osascript), musickit.ts + developer-token.ts; browser/: MusicKit JS adapter (see its README) |
| YouTube Music | src/music/providers/youtube-music/, extensions/youtube-music/probe/ | server catalog relayed through the admin browser (browser-catalog-bridge) |
| Persistence / schema | src/infra/ + src/domains/*/repository.ts | drizzle-orm/libsql; migrations.ts upgrades stored songs; per-mutation writes |
| SSE realtime | src/domains/events/ (public), playback.controller.ts /events (admin) | bus "mutate"/"progress" → SseBroker; 25s ping |
| Admin auth | src/domains/admin/admin-token.guard.ts | x-admin-token header vs .env ADMIN_TOKEN |
| Guest identity | src/middleware/device-cookie.middleware.ts | bj_did signed with DEVICE_COOKIE_SECRET (falls back to ADMIN_TOKEN) |
| UI | src/pages/ | see src/pages/AGENTS.md |

## API SURFACE
- Guest: GET /api/state, /api/search, /api/artwork, /api/table; POST /api/request, /api/cancel; SSE /api/events.
- Admin (/api/admin, x-admin-token): skip/pause/resume/previous/confirm-stopped, add/remove/reorder, tables (+ /:id/qr), settings.
- Admin music (/api/admin/music): config, developer-token, catalog-result, auth connect/disconnect, targets list/connect/disconnect.
- Admin playback (/api/admin/playback): snapshot, SSE events, owner/heartbeat/release, receipt/observation, confirm-browser-stopped, reconcile/reconciliation.
- Pages: / (guest), /admin → 302 /admin/songs, /admin/qr, /admin/music.

## CONVENTIONS
- fluo decorators on the server: @Module/@Inject/@Controller/@Router/@Path/@Get/@Post/@Delete/@Sse/@UseGuards; DTOs validated via @IsXxx + @FromBody/@FromQuery/@FromCookie/@FromPath.
- Handlers that need RequestContext still bind a DTO (`@RequestDto(...)`, even an empty one); otherwise the context argument is undefined.
- src/domains services/repositories and src/music stay framework-agnostic pure TS; only controllers, app.tsx, and providers.ts import @fluojs/*.
- Music module boundaries are test-enforced (src/music/boundaries.test.ts): core never imports a provider, browser code never imports server code, contracts hold no implementation, registry.ts never statically imports provider server/browser code, production never imports src/music/testing.
- Provider ports return MusicResult values instead of throwing; capabilities must match the mode descriptor or boot fails.
- File suffixes encode role: .controller.ts, .repository.ts, .guard.ts, .middleware.ts, .test.ts colocated; *.browser.ts in tests/ are real-browser runs.
- Strict TS: noUncheckedIndexedAccess, noImplicitOverride; Biome recommended preset, 2-space, noNonNullAssertion off.
- User-facing strings, comments, test names, and README are Korean (polite "~해요" tone); keep it.
- bun:test with Korean test names; service tests inject fakes, repository tests run against a real :memory: SQLite.

## WORKTREE LOCATION
- 새 작업 트리는 저장소 루트의 `.worktrees/<작업명>` 아래에 만들어요. 필요하면 `.worktrees/`를 먼저 만들고 Git 제외 상태를 확인해요.
- 올바른 예: 저장소 루트에서 `git worktree add .worktrees/my-task -b feat/my-task`
- 잘못된 예: `git worktree add ../bar-jukebox-wt/my-task -b feat/my-task`
- 작업 공간을 해당 저장소 안에 모아 다른 프로젝트나 사용자 폴더와 섞이지 않게 해요.

## ANTI-PATTERNS (THIS PROJECT)
- NEVER inherit DTO classes: field metadata binds to the parent class; flatten fields instead.
- Never import @fluojs/* in services, repositories, or src/music.
- Never call a concrete provider from domain code; go through the src/music/contracts ports wired in providers.ts.
- @babel/core must stay v7 (v8 removes allowDeclareFields and breaks fluo's babel config).
- Never restart a now-playing song restored from SQLite; it hydrates as "reconciliation-required" and the protocol reconciles it.
- Never let guest devices hit provider CDNs directly; artwork goes through /api/artwork?providerId=&artworkId=.
- Never bypass state rules in controllers; they live in services and are test-enforced.
- Never run real osascript or real iTunes in tests; inject fakes or use tests/support/itunes-preload.ts.
- Never commit jukebox.sqlite*, dist/, .env, .omo, .worktrees/ (all gitignored).

## UNIQUE STYLES
- Apple Music playback hack: Music.app ignores the `?i=` selector on music:// URLs, so playback mutes, opens the album, `next track`-skips to trackNumber, restores volume, and watches the current track id to cut off album auto-advance.
- Playback ownership: one executor owns playback per owner epoch; commands move prepared→sent→received→confirmed/rejected/unknown and are persisted, so restarts and browser executors reconcile instead of guessing.
- CSP is built in main.ts; MusicKit origins are added only when the active boot mode is apple-music/musickit. Saving a next-boot config never widens the current document's CSP.
- Page selection via fluo ReactNavigationPage + `module` path; renderPage checks the module exists in the Vite asset map. identifierPrefix "jukebox-react-" must match entry-client.tsx.

## COMMANDS
```bash
bun install            # Bun version pinned in .bun-version
bun run dev            # fluo server watch (does not rebuild client assets)
bun run dev:client     # Vite client watch incl. Tailwind CSS; run alongside dev
bun run build          # vite client build, then server build (both required)
bun start              # bun dist/server/main.js (needs client build)
bun test               # unit tests (bun:test)
bun run typecheck      # bunx tsc --noEmit
bun run check          # bunx biome check src test-flow.ts
bun run ci             # typecheck + check + test + build + test-flow + tests/*.ts browser/E2E suites
bun scripts/backup-database.ts <src.sqlite> <dest.sqlite>
```

## NOTES
- CI (.github/workflows/ci.yml, job `verify`) runs `bun run ci` on PRs and pushes to main. main is protected: changes land only through a PR with a green `verify` check, never by direct push. Browser suites need Chrome.
- Boot needs the client build (dist/client/.vite/manifest.json) and DEVICE_COOKIE_SECRET or ADMIN_TOKEN, or main.ts throws.
- Env: PORT (5173), DATABASE_URL (file:jukebox.sqlite), BASE_URL (else LAN-IP autodetect, baked into printed QRs; prefer a fixed mDNS hostname), MUSIC_PROVIDER, MUSIC_PLAYBACK_MODE, MUSICKIT_DEVELOPER_TOKEN, PLAYBACK_DISABLED=1. See .env.example and README (local preview with a fresh DATABASE_URL + PLAYBACK_DISABLED=1).
- Every mutation persists through its repository before memory/bus updates; bus "mutate" only wakes SSE.
- Admin-only playback data (owner, attempts, commands) never joins the public /api/state or /api/events payload.
- docs/plan-cloud.md: Apple Music cannot play from a cloud server; playback must stay on a venue-local device.
