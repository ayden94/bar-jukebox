# 바 주크박스 (Bar Jukebox)

바에서 손님이 QR로 곡을 신청하면, 바의 Mac에서 Apple Music으로 순서대로 틀어주는 시스템.
**백엔드/프론트엔드가 자체 프레임워크 [fluo](https://github.com/fluojs/fluo) 위에서 동작한다.**

## 구성

- **백엔드**: Bun + fluo (`@fluojs/core/http/runtime/platform-bun`) — 컨트롤러/DTO 검증/DI/`@Sse`
- **손님 화면** (`/?t=<테이블>&k=<시크릿>`): React (fluo ReactModule SSR + hydration, Vite 빌드)
  - 곡 검색·신청, 하단 미니플레이어 → 풀스크린 시트(앨범아트·진행바) → 대기열 확인, 본인 신청 곡 취소
- **바텐더 화면** (`/admin`): React — 재생/대기열(드래그 순서변경)/곡 추가, 테이블 & QR 관리·인쇄, 곡 신청 일시중지 토글, 공지
- **재생 루프**: `osascript`로 Music.app 제어 — 앨범 `music://` 오픈 후 뮤트 상태에서 트랙 스킵, 요청 곡 도달 시 볼륨 복구. 재생 위치는 1초 간격으로 SSE에 실시간 반영
- **실시간**: `@Sse`(`/api/events`) — 어드민 순서 변경/재생 상태가 손님 화면에 즉시 반영 (폴링 폴백 내장)

## 룰

- **기기당 동시 1곡**: 신원은 서버 발급 쿠키(`bj_did`, httpOnly, 1년) 기준. 이 기기에서 신청한 곡이 큐+재생중에 있으면 409로 차단
- **중복 방지**: 이미 큐/재생중인 같은 곡 재신청 차단
- **본인 곡 취소**: 손님이 자기 기기의 대기 곡을 직접 취소 가능
- **바텐더 추가 곡은 제한 없음**

## 테이블 & QR

1. `/admin`에서 테이블 추가 (예: "테이블 1")
2. 테이블별 QR은 `http://<서버주소>/?t=<id>&k=<시크릿>` 형태로 생성 (어드민에서 "QR 보기"/"전체 인쇄")
3. **QR은 한 번 인쇄하면 유지** — 서버 주소가 바뀌면 재인쇄가 필요하니 `BASE_URL`로 고정 호스트명(mDNS 등) 권장

## 실행

바의 Mac에서 (Apple Music 구독 계정으로 Music.app 로그인 상태):

```bash
cd bar-jukebox
bun install
cp .env.example .env
# .env의 ADMIN_TOKEN을 긴 랜덤 문자열로 변경
bunx vite build --config vite.client.config.ts
bunx vite build --config vite.server.config.ts
bun dist/server/main.js
```

- 바텐더: `http://localhost:5173/admin` — 비밀번호는 `.env`의 `ADMIN_TOKEN`
- 손님: 어드민에서 생성한 테이블 QR 스캔 (같은 WiFi)
- API 플로우 점검: `ADMIN_TOKEN=<토큰> bun test-flow.ts`

### .env

```
ADMIN_TOKEN=긴-랜덤-문자열
PORT=5173
# QR에 들어갈 공개 주소 (미설정 시 LAN IP 자동 감지)
# BASE_URL=http://barjukebox.local:5173
```

## 영속화 & 개발

- 상태(큐/히스토리/재생중/설정/테이블)는 SQLite(`jukebox.sqlite`)에 저장 — 재시작해도 큐가 유지되고, 재생 중이던 곡은 다시 틀지 않고 종료만 기다림
- 검증: `bun test` (단위테스트), `bun run typecheck`, `bun run check` (biome)
- 구조: `docs/plan-migration.md` (fluo 이관 계획), `docs/plan-local.md` (로컬 트랙), `docs/plan-cloud.md` (클라우드 SaaS 트랙)
