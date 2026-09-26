# src/pages — React UI (AGENTS.md: score 9, distinct domain)

## OVERVIEW
Two React sub-apps (guest, admin) served through fluo ReactModule SSR + hydration; shared hooks, theme, and view types live at this level. entry-client.tsx / entry-server.ts are the Vite build entries.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Live state (SSE + polling fallback) | hooks.ts useJukeboxSnapshot | EventSource /api/events; 3s polling after SSE error |
| Toast / infinite scroll | hooks.ts | useToast, useInfiniteScroll |
| Dark/light theme | theme.ts | `<html data-theme>`, localStorage bj_theme, inline SSR script |
| Guest flow | guest/guest-app.tsx | search → request → mini-player → full sheet → queue (cancel own) |
| Admin flow | admin/admin-app.tsx | AuthGate → SongsTab / QrTab (hash routing #songs/#qr) |
| Shared view types | types.ts | SongView/Snapshot mirror jukebox/types minus server-only fields |
| Build entries | entry-client.tsx, entry-server.ts | client picks page via data-page; server re-exports the two Documents |
| Styling | styles.css (+ styles.d.ts shim) | single stylesheet, plain classes, dark/light via data-theme |

## CONVENTIONS (different from parent)
- Client never imports server code: view types are re-declared in pages/types.ts (SongView vs Song).
- All mutations POST then refresh() the snapshot; components render purely from `snap`.
- Artwork always through the art() helper in shared.ts (/api/artwork?u=…), never raw mzstatic URLs.
- Admin requests carry the x-admin-token header (token cached in localStorage bj_admin); guest requests rely on the bj_did cookie only.
- No CSS framework: one styles.css (~19KB) with plain classes; styles.d.ts shim allows `import "./styles.css"`.
- Keep identifierPrefix "jukebox-react-" in sync between app.tsx (manifest) and entry-client.tsx (hydrateRoot).

## ANTI-PATTERNS
- Don't add a second state-fetch path — reuse useJukeboxSnapshot/refresh.
- Don't trust table identity from anywhere but the QR query params (?t=&k=) — the server re-validates the secret.
- Don't put admin-only fields on guest endpoints; guest identity is the cookie, never a nickname.
- Don't diverge markup between renderPage SSR output and hydrateRoot input — hydration mismatches break the page.
