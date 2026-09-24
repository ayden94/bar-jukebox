# fluo 이관 계획 (Hono → fluo + React)

> 2026-09-24 작성. 스파이크 완료 후 확정. 목적: bar-jukebox를 자체 프레임워크 fluo + @fluojs/react로 이관.

## 0. 스파이크 결과 (2026-09-24, 전 항목 통과)

| # | 검증 | 결과 |
|---|---|---|
| 1 | Bun 어댑터 부팅 (`BunHttpApplicationAdapter` + `FluoFactory`) | ✅ bun 직접 실행, 데코레이터 무문제 |
| 2 | `@Get` 라우팅 + DI (`@Inject`, `@Module`) | ✅ |
| 3 | `@Sse` 스트리밍 (AsyncIterable → event/data 프레임) | ✅ 5개 이벤트 순차 수신 |
| 4 | Vite 빌드 (`fluoDecoratorsPlugin`로 데코레이터 컴파일) | ✅ client(manifest)+server(ssr) 분리 빌드 |
| 5 | React SSR + hydration (Bun 실행, 실제 WebKit에서 클릭) | ✅ Count: 0 → 클릭 → Count: 1 |

**스파이크 발견 사항**:
- `@babel/core`는 **v7로 고정**해야 함 (v8은 `allowDeclareFields` 제거로 fluo 바벨 설정과 충돌)
- react-vite-ssr 예제 구조 그대로 재현 가능: client build(manifest) + server build(ssr) → `bun dist/server/main.js`
- fluo 패키지는 전부 npm 배포됨 (core 2.1.1 / http 3.1.2 / runtime 3.1.1 / platform-bun 3.0.1 / react 0.2.1 / vite 2.0.1)

## 1. 대상 아키텍처

```
src/
  main.ts                 # FluoFactory.create(AppModule, BunHttpApplicationAdapter) + manifest 로딩
  app.module.ts           # JukeboxModule: controllers + providers + ReactModule
  jukebox/
    state.ts  db.ts  bus.ts  types.ts   # ← 기존 그대로 (프레임워크 불가지론)
    playback.ts  search.ts             # ← 기존 그대로 (osascript/iTunes)
    state.provider.ts  db.provider.ts  playback.provider.ts   # 기존 로직을 DI provider로 포장
  controllers/
    jukebox.controller.ts   # /api/state, /api/table, /api/search, /api/request, /api/cancel
    admin.controller.ts     # /api/admin/* (skip/remove/add/reorder/tables/qr/settings)
    events.controller.ts    # @Sse /api/events — bus 구독 → AsyncIterable 브로드캐스트
  middleware/
    device-cookie.middleware.ts   # bj_did 발급/보장 (fluo middleware)
  pages/                  # React
    guest/                 # 손님 화면: 검색 + 미니플레이어/시트/대기열 (기존 CSS 이식)
    admin/                 # 어드민: 재생/큐/테이블&QR/설정/인쇄
vite.client.config.ts      # manifest: true, entry-client
vite.server.config.ts      # ssr: src/main.ts, plugins: [fluoDecoratorsPlugin()]
```

**실행**: `bun dist/server/main.js` (빌드: `vite build` client → server). BASE_URL LAN 감지·QR 생성·SQLite 영속화는 현행 유지.

## 2. 이관 대상 vs 재사용

| 구성요소 | 처리 |
|---|---|
| state.ts / db.ts / bus.ts / types.ts / search.ts / playback.ts + 단위테스트 | **그대로 재사용** |
| server.ts (Hono 150줄) | 컨트롤러 3개 + 미들웨어 1개로 분해 이식 |
| public/index.html (손님) | React 페이지로 전환 (기존 CSS/동작 스펙 이식) |
| public/admin.html (어드민) | React 페이지로 전환 |
| .env / 영속화 / QR 로직 | 유지 |

## 3. 단계 (각 단계 = 커밋 1개 이상, 실제 시각으로 쌓임)

- **P1 골격** — fluo 의존성 설치, vite 설정 2개, 기존 로직 파일 이동 + provider 포장, 빈 AppModule 부팅. 완료기준: `bun dist/server/main.js`로 부팅되고 `/hello` 스모크 라우트 응답
- **P2 API 이식** — 컨트롤러 3개 + 기기쿠키 미들웨어 + `@Sse` 이벤트 스트림. 완료기준: 기존 `test-flow.ts` 전 단계 통과(호스트/포트만 변경)
- **P3 손님 화면** — React 전환: 테이블 칩/검색/신청, 미니플레이어→풀시트(아트·진행바)→대기열(내 곡 취소), SSE 구독 훅, 일시중지·공지 배너. 완료기준: 기존 스크린샷 시나리오 동일 재현(모바일 390px)
- **P4 어드민 화면** — React 전환: 재생/큐(드래그)/추가, 테이블&QR(보기·인쇄), 설정(토글·공지). 완료기준: 어드민 스크린샷 동일 재현 + QR 인쇄 페이지 출력
- **P5 검증/마무리** — 단위테스트 유지 확인, typecheck, biome, 라이브 재생 E2E, README 갱신

## 4. 리스크

1. **@fluojs/react 0.x** — 스파이크에서 SSR/hydration 검증됐으나, 우리 페이지(스타일·인터랙션 많음) 이식 중 0.x 특유의 거친 부분을 만날 수 있음 → P3에서 여유 갖고 진행
2. **SSE 긴 연결 + 어댑터 idleTimeout** — Bun 어댑터 `idleTimeout` 옵션 존재 확인. P2에서 25초 핑과 함께 실측
3. **Vite 번들에 bun:sqlite/node:os 포함** — server 번들이 외부화(externalize) 처리되는지 P1에서 확인, 필요 시 ssr.noExternal 조정
4. **Babel 버전** — 스파이크에서 v7/v8 모두 검증:
   - **v7 고정이 기본값** (fluo 내장 설정과 즉시 호환, 무노벨티)
   - v8을 쓰려면 `fluoDecoratorsPlugin({ babelConfigFile })`로 커스텀 설정 필요: `preset-typescript`는 옵션 없이, `plugin-proposal-decorators { version: '2023-11' }` 유지 — 스파이크에서 SSR/hydration 동작 확인
   - 주의: `babelConfigFile`에는 파일 시스템 경로만 허용 (file:// URL은 "Cannot find module" 오류)
   - fluo 내장 설정의 `allowDeclareFields` 하드코딩은 Babel 8에서 치명적 오류 → fluo 쪽 별도 개선 이슈로 분리 (주크박스와 무관)

## 5. 롤백

이관은 별도 작업으로 커밋이 쌓이는 방식이므로, Hono 버전은 `main` 히스토리에 남음. 문제 시 특정 커밋으로 revert하면 됨.
