# src/pages — React UI (AGENTS.md: score 9, distinct domain)

## OVERVIEW
Two React sub-apps (guest, admin) served through fluo ReactModule SSR + hydration; shared hooks, theme, and view types live at this level. entry-client.tsx / entry-server.ts are the Vite build entries.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Live state (SSE + polling fallback) | hooks.ts useJukeboxSnapshot | EventSource 자동 재연결; 끊긴 동안만 3s 폴링, 복구 시 중단 |
| Toast / infinite scroll | hooks.ts | useToast, useInfiniteScroll |
| Theme (light/dark/system) | theme.ts + theme-segment.tsx | 쿠키 bj_theme 3-상태(구 localStorage 자동 마이그레이션); 인라인 스크립트가 system을 matchMedia로 해석 — data-theme은 항상 구체값; UI는 게스트/관리자 공통 세그먼트 컨트롤 |
| Guest flow | guest/guest-app.tsx | search → request → mini-player → full sheet → queue (cancel own) |
| Admin flow | admin/songs-page.tsx · admin/qr-page.tsx | Per-route page documents sharing admin/session.tsx (AuthGate → chrome → SongsTab / QrTab) |
| Shared view types | types.ts | SongView/Snapshot mirror jukebox/types minus server-only fields |
| Build entries | entry-client.tsx, entry-server.ts | client picks page via data-page; server re-exports the page documents |
| Styling | styles.css (+ styles.d.ts shim) | single stylesheet, plain classes, dark/light via data-theme |

## CONVENTIONS (different from parent)
- Client never imports server code: view types are re-declared in pages/types.ts (SongView vs Song).
- All mutations POST then refresh() the snapshot; components render purely from `snap`.
- Artwork always through the art() helper in shared.ts (/api/artwork?u=…), never raw mzstatic URLs.
- Admin requests carry the x-admin-token header (token cached in localStorage bj_admin); guest requests rely on the bj_did cookie only.
- 공개 곡의 isMine으로 본인 신청을 구분한다. deviceId나 쿠키 서명은 응답에서 읽지 않는다.
- API 오류는 shared.ts의 apiErrorMessage로 구조화된 error.message를 추출한다. 검색은 이전 요청을 취소하고 최신 응답만 반영한다.
- No CSS framework: one styles.css (~19KB) with plain classes; styles.d.ts shim allows `import "./styles.css"`.
- Keep identifierPrefix "jukebox-react-" in sync between app.tsx (manifest) and entry-client.tsx (hydrateRoot).

## ANTI-PATTERNS
- Don't add a second state-fetch path — reuse useJukeboxSnapshot/refresh.
- Don't trust table identity from anywhere but the QR query params (?t=&k=) — the server re-validates the secret.
- Don't put admin-only fields on guest endpoints; guest identity is the cookie, never a nickname.
- Don't diverge markup between renderPage SSR output and hydrateRoot input — hydration mismatches break the page.
- Don't put "system" into data-theme: 서버 굽기(bakedTheme)·인라인 스크립트·클라이언트 렌더는 모두 구체값(light/dark)을 내야 하고, system 해석은 스크립트/훅의 몫이다. <html>의 suppressHydrationWarning은 유지.
