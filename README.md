<div align="center">
  <img src="public/icon-tile.svg" width="96" alt="바 주크박스 — 바이닐 아이콘" />
  <h1>🎵 바 주크박스</h1>
  <p><b>손님은 QR로 신청하고, 바의 Mac에서 Apple Music으로 틀어주는 주크박스</b></p>
  <p>
    <img alt="Bun" src="https://img.shields.io/badge/Bun-1.4-000000?logo=bun" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-SSR-61dafb?logo=react&logoColor=black" />
    <img alt="SQLite" src="https://img.shields.io/badge/SQLite-영속화-003b57?logo=sqlite&logoColor=white" />
  </p>
</div>

---

## ✨ 한눈에 보기

| | 무엇을 하나요 |
|---|---|
| 📱 **손님 화면** (`/?t=<테이블>&k=<시크릿>`) | 테이블 QR 스캔 → 곡 검색·신청 → 하단 미니플레이어에서 재생 상태 확인 → 시트에서 대기열 확인·본인 곡 취소 |
| 🎛️ **바텐더 화면** (`/admin/songs` · `/admin/qr`) | 재생/대기열(드래그 순서 변경) 관리, 곡 추가, 테이블 & QR 생성·인쇄, 신청 일시중지·공지·곡 수 제한 설정 |
| 🎧 **재생 루프** | `osascript`로 Music.app을 제어해 **요청 곡 하나만** 순서대로 재생 |
| ⚡ **실시간** | SSE(`/api/events`)로 재생 상태·대기열 변경을 손님 화면에 즉시 반영 (폴링 폴백 내장) |
| 💾 **영속화** | 큐·히스토리·재생중·설정·테이블을 SQLite에 저장 — 서버를 재시작해도 이어짐 |

## 🎧 동작 흐름

```mermaid
flowchart LR
    A[손님 QR 스캔] -->|곡 신청| B[fluo 서버<br/>대기열 · 규칙 · SSE]
    C[바텐더 /admin] -->|관리 · 곡 추가| B
    B -->|재생 루프| D[Music.app<br/>osascript 제어]
    D --> E[바 스피커]
    B -.->|실시간 상태| A
```

1. 손님이 테이블 QR을 스캔하면 서버가 발급한 기기 쿠키(`bj_did`)로 신원을 확인해요.
2. 신청은 대기열에 **요청 곡 1곡**만 들어가고, 규칙(중복·곡 수 제한)을 통과한 곡만 쌓여요.
3. 재생 루프가 대기열에서 다음 곡을 꺼내 Music.app으로 재생하고, 곡이 끝나면 다음 곡으로 넘어가요.

> **재생 방식에 대하여** — Music.app은 `music://` 앨범 주소로 열면 앨범 전체가 재생 대기열에 들어가지만,
> 뮤트 상태에서 목표 트랙까지 스킵해요. `play once`만으로 앨범 문맥이 제거된다고 가정하지 않아요.
> 실제 관측으로 재생과 종료를 확인하고, 무관한 외부 곡 변경은 완료로 처리하지 않아요.
> 재생 위치는 1초 간격으로 SSE에 실시간 반영돼요.

## 📐 신청 규칙

| 규칙 | 기본값 | 설명 |
|---|---|---|
| 기기(1인)당 곡 수 | **1곡** | 재생중 + 대기 합산. 도달하면 신청 버튼이 잠겨요 |
| 테이블당 곡 수 | **5곡** | 같은 테이블의 모든 기기를 합산해 세요 |
| 중복 트랙 | 차단 | 이미 재생중/대기 중인 같은 곡은 다시 신청할 수 없어요 |
| 본인 곡 취소 | 허용 | 손님이 자기 기기의 대기 곡을 직접 취소할 수 있어요 |
| 바텐더 곡 추가 | 무제한 | `/admin`의 곡 추가는 제한을 건너뛰어요 |

두 제한은 어드민 **운영 설정**에서 언제든 바꿀 수 있어요. `0`을 넣으면 무제한이에요.

## ⚠️ Music.app 자동 재생 끄기 (꼭 한 번!)

> Music.app → 설정 → 재생에서 **자동 재생(비슷한 노래 이어 재생)을 꺼주세요.**
> 켜져 있으면 요청 곡이 끝난 뒤 추천 곡이 대기열에 이어서 쌓입니다.
> 이 설정은 AppleScript로 바꿀 수 없어 수동으로 꺼야 해요.

무관한 외부 재생을 자동으로 끄지 않으므로, 운영 전에 자동 재생을 꺼주세요.

## 🚀 시작하기

바의 Mac에서 (Apple Music 구독 계정으로 Music.app 로그인 상태):

```bash
git clone https://github.com/ayden94/bar-jukebox.git
cd bar-jukebox
bun install
cp .env.example .env      # ADMIN_TOKEN을 긴 랜덤 문자열로 변경!
bun run build             # 클라이언트 + 서버 빌드
bun start
```

- 🎛️ 바텐더: `http://localhost:5173/admin` (노래 관리 `/admin/songs` · QR 관리 `/admin/qr`) — 비밀번호는 `.env`의 `ADMIN_TOKEN`
- 📱 손님: 어드민에서 만든 테이블 QR 스캔 (같은 Wi-Fi)
- 🧪 격리 API 플로우 점검: `bun run build && bun test-flow.ts`

## ⚙️ .env

```bash
ADMIN_TOKEN=긴-랜덤-문자열
PORT=5173
# 기기 쿠키 서명 키 (미설정 시 ADMIN_TOKEN 사용)
# DEVICE_COOKIE_SECRET=별도의-긴-랜덤-문자열

# QR에 인쇄될 공개 주소 (미설정 시 LAN IP 자동 감지)
# BASE_URL=http://barjukebox.local:5173
```

> **QR은 한 번 인쇄하면 유지**돼요. 서버 주소가 바뀌면 재인쇄가 필요하니 `BASE_URL`로
> 고정 호스트명(mDNS 등)을 쓰는 걸 권장해요.

기기 쿠키는 서명을 검증하고, 공개 상태에는 기기 ID 대신 `isMine`만 내려줘요.
기존 미서명 쿠키는 새 기기로 교체되므로 업데이트 전에 남은 손님 신청을 비우거나
직원이 관리해주세요. 서명 키를 바꾸면 기존 기기 쿠키도 무효가 돼요.
곡 신청과 직원 추가는 `providerId`와 문자열 `trackId`만 받고 서버가 선택된 공급자에서 재생 정보를 조회해요.
큐·재생중·완료 전환과 설정은 DB 저장에 성공한 뒤 화면에 반영해요.

## 🗂 프로젝트 구조

```
src/
├── main.ts             # 서버 부팅: SQLite 복원 → 앱 기동 → 재생 루프
├── app.tsx             # 라우터·컨트롤러·미들웨어·React 페이지 연결
├── domains/            # queue / table / settings / search / playback / events / admin
│                       #   controller → service → repository (도메인 규칙은 service에)
├── infra/              # drizzle-orm/libsql 클라이언트 + 스키마
├── music/              # 공통 계약 / 공급자별 내부 모듈 / 테스트 계약 도구
├── middleware/         # 기기 식별 쿠키 (bj_did)
└── pages/              # 손님·관리자 React UI (SSR + hydration)
```

## ✅ 검증

```bash
bun run ci             # CI와 동일한 전체 검사·빌드·API·브라우저 회귀
bun test               # 단위 테스트 (큐 규칙 · 저장소 round-trip · 재생)
bun run typecheck      # TypeScript strict
bun run check          # Biome lint + format
bun run build && bun test-flow.ts # 임시 DB·임시 서버·고정 검색 데이터로 HTTP 회귀 검증
bun run dev            # 개발 서버 (fluo dev)
bun run dev:client     # 별도 터미널에서 클라이언트/CSS 빌드 감시
```

플로우 검증은 운영 토큰이나 실행 중인 서버를 사용하지 않고, 실패하면 비정상 종료해요.
실제 Music.app은 실행하지 않아요. 별도 수동 검증 서버가 필요하면
`DATABASE_URL=:memory: PLAYBACK_DISABLED=1`로 실행할 수 있어요.
운영에서는 `PLAYBACK_DISABLED`를 설정하지 마세요.

### PR 병합 전 필수 CI

`.github/workflows/ci.yml`은 main 대상 PR과 main push에서 `verify` 검사를 실행해요.
`.bun-version`의 Bun 1.4.2와 `bun install --frozen-lockfile`로 설치한 뒤
타입 검사, Biome 검사, 전체 단위 테스트, 클라이언트·서버 빌드, 격리 API 흐름,
관리자 이동·이동 보호·공급자 중립 검색/신청 브라우저 회귀를 순서대로 실행해요. 하나라도 실패하면 검사도 실패해요.

로컬에서는 Chrome을 설치한 뒤 `bun run ci`를 실행하면 같은 검사를 수행해요.
CI는 Chrome이 제공되는 Ubuntu 24.04 runner를 사용하고, 운영 음악 계정이나
실제 Music.app 없이 임시 DB·임시 토큰·격리 fixture로 검증해요.

main의 필수 status check는 GitHub Actions가 발행하는 `verify`예요.
최신 main 기준 검사가 성공해야 PR을 병합할 수 있도록 보호하며 관리자에게도 적용해요.
검사 이름을 변경할 때는 보호 규칙도 함께 바꿔야 해요.
workflow 파일 작성과 실제 GitHub 실행은 별개이므로 최초 PR에서 runner 결과도 확인해요.

### React 구성과 이동 검증

`@fluojs/react 0.3.0`의 `ReactNavigationPage`와 공식 initial-page decoder를
사용해 SSR과 hydration, 내부 이동을 연결해요. `/admin/songs`와 `/admin/qr`는
서버 라우트와 페이지 컴포넌트를 따로 유지하고, 내부 이동에서는 공통 문서와
`AdminSession`을 유지해요. 페이지별 검색 입력과 QR 펼침 상태는 이동 시 초기화돼요.
SSE와 폴링은 문서당 브라우저 스토어 하나가 소유하며 `pagehide`에서 닫고
`pageshow`에서 구독자가 있을 때 한 번만 다시 연결해요.

현재 Bun 어댑터는 공식 Node starter의 단일 `fluo dev` Fast Refresh/CSS HMR
지원 대상이 아니에요. 기존 두 개발 명령을 유지하고 Babel 7을 사용해요.
배포할 때는 클라이언트와 서버를 함께 빌드하고 재시작해요.
관리자 내부 이동의 네트워크·서버·화면 파일 오류에서는 현재 셸을 유지하고
다시 시도하거나 전체 페이지로 열 수 있어요. 빌드가 달라진 경우에는 자동으로
새로고침하지 않고 새 버전으로 여는 버튼을 제공해요.
다시 시도는 실패 목적지로 새 내부 이동을 요청해요. 이동 확인을 취소해도
복구 링크를 다시 사용할 수 있으며, 실패한 history 이동 자체를 재개하지는 않아요.
공지·곡 수 제한·새 테이블 이름의 미저장 입력과 처리 중 작업은 이동 전에
확인해요. 새로고침·탭 닫기는 브라우저 기본 확인을 사용하며 저장을 자동으로
재전송하지 않아요. 401/403은 입력 확인보다 먼저 관리자 화면과 SSE 구독을
정리하고 재로그인을 요구해요.

브라우저 검증은 임시 DB·임의 포트·임시 토큰으로 재생 비활성화 서버를 직접
시작하고 종료 시 정리해요. 별도 실행 중인 서버나 운영 계정을 사용하지 않아요.
실제 SSE 전송 단절·네트워크 복구와 외부 문서 왕복을 검증해요.
운영의 `no-store` 응답에서는 일반 재로딩 복구를 확인하고, 테스트 프록시가
HTML 캐시 헤더만 바꾼 별도 시나리오에서는 실제 `pageshow.persisted=true`와
같은 문서의 SSE 재연결을 확인해요. 운영 캐시 정책은 바꾸지 않아요.

```bash
bun run build
bun test-flow.ts                      # IPC 준비 신호로 실제 포트를 받아요.
bun tests/react-navigation.browser.ts # Bun 1.4+, 설치된 Chrome 필요
bun tests/navigation-protection.browser.ts # 이동 실패·재시도·입력·인증 철회 회귀
bun tests/music-contract.browser.ts   # 문자열 식별자·cursor·커버·신청 계약
```

### 저장 데이터 검사와 백업

서버는 대기열·최근 재생·현재 재생 곡의 JSON 구조와 숫자 범위를 검사해요.
손상된 행을 조용히 제외하지 않고 테이블·행 식별자와 오류 종류를 표시하며
시작을 중단해요. 원본 데이터는 삭제하지 않으므로 먼저 백업한 뒤 복구해주세요.
SQLite `user_version=1`은 `formatVersion: 1`과 공급자별 문자열 곡 식별자를 사용해요.
기존 숫자 Apple ID는 문자열로 변환하고 요청 UUID·순서·소유권·시각을 보존해요.
기존 파일은 첫 전환 전에 `<DB 경로>.before-v1-<UUID>.sqlite`로 백업해요.
모든 곡 변환과 버전 갱신은 한 트랜잭션이며, 손상 행이나 SQL 오류가 나면 전체를 롤백해요.
미래 DB 버전은 읽지 않아요. 이전 코드로 돌아갈 때는 서버와 재생을 멈춘 뒤
v1 전환 전 백업을 함께 복원해야 해요. 백업 이후 신청은 별도로 보존·대조해야 하며
구버전 코드에 v1 DB를 그대로 연결하지 마세요.

재시작한 현재 곡은 재확인 상태로 복원하며 자동으로 다시 재생하지 않아요.
정확히 일치하는 실행을 증명할 수 없으면 신청을 보존하고 제어를 거절해요.
관리자 현재 곡 패널에서 안내를 확인하고, 음악 앱/기기의 실제 오디오를 직접
멈춘 뒤 확인 체크박스와 **정지 확인 후 넘기기**를 사용해주세요.
화면에 보인 해당 신청만 완료하며, 다른 곡으로 바뀐 확인 요청은 거절해요.
선택한 공급자와 다른 활성 요청이 저장되어 있으면 삭제하지 않고 신규 신청과 재생을 보류해요.

```bash
# URL이 아닌 파일 경로를 전달해요. 출력 부모 폴더는 미리 만들어주세요.
bun scripts/backup-database.ts ./jukebox.sqlite ./backups/jukebox-2026-10-15.sqlite
```

백업은 SQLite의 `VACUUM INTO`로 WAL의 커밋된 데이터까지 일관된 스냅샷으로
저장해요. 실행 중인 DB에도 사용할 수 있고, 기존 출력 파일은 덮어쓰지 않아요.
백업 파일에는 테이블 시크릿과 신청 소유권 정보가 있으므로 생성 시의
소유자 전용 권한(`0600`)을 유지해주세요.

복원할 때는 DB를 사용하는 서버·도구를 모두 종료한 뒤 기존 DB와 같은 이름의
`-wal`·`-shm` 파일을 함께 다른 위치에 보관해요. 완료된 백업 파일만 설정된
DB 경로에 배치하고, 그 경로에 예전 sidecar 파일이 남지 않았는지 확인한 뒤
서버를 시작해주세요. 실행 중인 원본 DB 파일만 복사하는 방식은 사용하지 않아요.

## 📚 문서

| 문서 | 내용 |
|---|---|
| [`docs/plan-local.md`](docs/plan-local.md) | 로컬 트랙 설계 |
| [`docs/plan-migration.md`](docs/plan-migration.md) | fluo/React 마이그레이션 계획 |
| [`docs/plan-cloud.md`](docs/plan-cloud.md) | 클라우드 SaaS 트랙 (재생은 항상 현장 기기) |
