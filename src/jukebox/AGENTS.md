# src/jukebox — domain core (AGENTS.md: score 9, distinct domain)

## OVERVIEW
Framework-agnostic domain: queue state machine, SQLite persistence, Music.app playback (osascript), iTunes search, artwork proxy, event bus. The only fluo seam is providers.ts.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Queue rules (device/track limits, reorder, own-cancel) | state.ts | deviceHasActive, trackIsActive, removeOwnedFromQueue, reorder |
| Schema or persistence changes | schema.ts + db.ts | drizzle schema; saveSnapshot rewrites queue/history/now_playing wholesale in one async transaction |
| Playback behavior | playback.ts | playSong mute→skip trick; waitForTrackEnd guards album auto-advance |
| New injectable service | providers.ts | add a Token class + entry in jukeboxProviders |
| Env/config values | config.ts | ADMIN_TOKEN, PORT, BASE_URL (env or LAN-IP autodetect) |
| SSE wakeups | sse-broker.ts | notify() wakes all waiters; EventsController subscribes bus.onChange |
| Event bus | bus.ts | only two events exist: "mutate" and "progress" |
| Artwork proxy | artwork.ts | mzstatic-only allowlist, in-memory cache (max 200, cleared wholesale) |

## CONVENTIONS (different from parent)
- No `@fluojs/*` imports here — pure TS; exports are wrapped as DI values in providers.ts.
- Every mutation ends with emit("mutate"); position ticks emit emit("progress") at ~1Hz — persistence (main.ts) and SSE (events.controller.ts) hang off these two events only.
- Singletons (`state`, db namespace) are both imported directly and exposed via DI tokens; tests reset the singleton with hydrate(emptyState()).
- playback.ts keeps testable seams: TrackNavigator / VolumeController interfaces injected by tests; osascript only behind osa().
- History is capped at MAX_HISTORY=50 in state.ts; finished songs unshift to the front on "done" only.
- db.ts opens jukebox.sqlite via libsql (file: URL relative to the process cwd) — run the server from the repo root; snapshot writes are serialized through a promise chain.

## ANTI-PATTERNS
- Never write SQLite outside db.ts/schema.ts; never touch Music.app outside playback.ts.
- Never pair @fluojs/drizzle with sync drivers (drizzle-orm/bun-sqlite) — rollback breaks silently; use drizzle-orm/libsql.
- Never restart a hydrated now-playing song — startPlaybackLoop waits for it to end before entering the main loop.
- Never let tests spawn real osascript — inject TrackNavigator/VolumeController fakes (see playback.test.ts).
- Never return unvalidated raw iTunes fields from search.ts — shape them into SearchHit and dedupe by trackId.
