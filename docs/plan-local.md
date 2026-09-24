# 로컬 주크박스 구현 계획 (Track 1 — PoC)

> 2026-09-24 작성. 바의 Mac 1대에서 돌아가는 단일 점포 주크박스. 클라우드 전환(Track 2, `plan-cloud.md`)의 전단계이자 시장 검증 PoC.

## 1. 목표

- 바의 Mac 1대 + 로컬 WiFi 안에서 전부 동작 (외부 인터넷 노출 없음)
- 손님: 테이블 QR 스캔 → 모바일에서 검색·신청, 실시간 큐 확인
- 바텐더: 웹 어드민에서 재생/대기열/테이블/공지 관리
- 재생: Mac의 Apple Music(Music.app)을 osascript로 제어

## 2. 완료 기준 (Acceptance)

1. 실제 폰으로 QR 스캔 → 닉네임 입력 없이 검색·신청 완료
2. 같은 기기의 동시 2곡 신청 차단(409), 이미 큐에 있는 곡 중복 신청 차단(409)
3. 어드민이 순서를 드래그로 바꾸면 손님 화면에 즉시(SSE) 반영
4. 재생 중 손님 화면에 진행바가 실시간으로 움직임
5. 서버 재시작 후에도 큐/테이블/설정이 유지됨 (SQLite 영속화)
6. 어드민에서 테이블 추가 → 테이블별 QR 인쇄 페이지 출력
7. `bun test` / `bun run typecheck` / `bun run check` 모두 통과
8. 실제 Mac에서 QR 스캔 → 신청 → 재생 → 순서변경 실시간 반영 E2E 확인

## 3. 확정 스펙 (대화 합의)

| 항목 | 결정 |
|---|---|
| 손님 신원 | 서버 발급 httpOnly 쿠키 `bj_did` (1년), 기기당 큐+재생중 1곡 |
| 닉네임 | 제거. 큐 표시는 테이블명 ("테이블 3") |
| 테이블 QR | 어드민에서 생성, `http://<호스트>/?t=<id>&k=<secret>`. 한 번 인쇄하면 유지 |
| QR 안정성 | 호스트 고정 권장: macOS mDNS(`barjukebox.local`). IP가 바뀌어도 QR 유지 |
| 손님 UI | 애플뮤직 스타일: 검색 화면 + 하단 미니플레이어 → 탭하면 풀시트(앨범아트/제목/진행바) → 시트 안에서 대기열 리스트 (내 곡 하이라이트 + 취소) |
| 실시간 | SSE (`/api/events`), 변경 시 전체 스냅샷 브로드캐스트. 폴링 폴백 |
| 영속화 | bun:sqlite — queue / history / now_playing / settings / tables |
| 부가 | 중복 곡 방지, 본인 곡 취소, 신청 일시중지 토글, 공지 메시지, 예상 대기시간(곡 길이 합) |
| 진행바 | osascript `player position` / `duration of current track` (재생 루프가 1초 폴링) |

## 4. 기술 구조와 현재 상태

스택: Bun + Hono + bun:sqlite + osascript. 프레임워크 교체 없음.

| 파일 | 역할 | 상태 |
|---|---|---|
| `src/types.ts` | Song/NowPlaying/JukeboxState (deviceId 기반) | ✅ 교체 완료 |
| `src/bus.ts` | mutate/progress 이벤트 버스 (SSE+영속화 트리거) | ✅ 신규 |
| `src/state.ts` | 큐 스토어 — deviceHasActive, trackIsActive, 설정, 진행률 | ✅ 교체 완료 |
| `src/db.ts` | SQLite 영속화 (loadState/saveSnapshot/테이블 CRUD) | ✅ 신규 |
| `src/search.ts` | iTunes 검색 + durationSec 추가 | ✅ 수정 완료 |
| `src/playback.ts` | osascript 재생 루프 | ⏳ 진행률 수신 + 재시작 복구 필요 |
| `src/server.ts` | 라우트 | ⏳ 재작성 필요 (쿠키/테이블/SSE/QR/취소/토글) |
| `public/index.html` | 손님 화면 | ⏳ 애플뮤직 스타일 리뉴얼 |
| `public/admin.html` | 어드민 | ⏳ 테이블/QR/설정/인쇄 추가 |
| `src/state.test.ts` | 상태 로직 테스트 | ⏳ 신규 |

> ⚠️ 현재 중간 상태: 타입이 먼저 바뀌어서 server.ts가 아직 구타입(patronKey)을 참조한다.
> **이 상태에서 서버를 재시작하면 큐 라우트가 깨진다.** 남은 작업을 마친 뒤 재시작할 것.
> (현재 실행 중인 프로세스는 구 코드가 메모리에 로드된 상태라 영향 없음)

## 5. 남은 작업 (실행 순서)

1. **playback.ts** — `waitForEnd`에서 1초마다 position/duration 읽어 `state.updateProgress()` 호출. 부팅 시 복원된 nowPlaying은 재시작하지 않고 종료만 대기 → 이후 메인 루프 진입
2. **server.ts 재작성** — 쿠키 미들웨어(`/api/*`에 bj_did 보장), `POST /api/request`(테이블 검증+기기 1곡+중복 방지+일시중지 체크), `POST /api/cancel`(본인 곡만), 테이블 CRUD + QR SVG(`qrcode` 패키지 설치됨), SSE(`/api/events` + bus 구독, mutate→saveSnapshot+브로드캐스트, progress→브로드캐스트만), 설정(토글/공지), `GET /api/table?t&k`(손님 부트스트랩: 라벨/상태/deviceId), BASE_URL은 env 또는 LAN IP 자동 감지
3. **index.html** — 애플뮤직 스타일 리뉴얼 (다크 + Apple Music 레드 포인트, 미니플레이어 → 스프링 시트 → 대기열 토글, 내 곡 ✕ 취소, 일시중지/공지 배너, 테이블 칩)
4. **admin.html** — 테이블 관리 패널(추가/삭제/QR 보기), 설정 패널(신청 토글/공지), QR 인쇄 뷰(`@media print`), 큐 행에 테이블명 표시
5. **검증** — state.test.ts(기기 룰/중복/reorder/hydrate), typecheck, biome, 서버 재기동 후 라이브 API 플로우(테이블 생성→신청→409→취소→SSE 수신), Bun.WebView로 모바일 폭(390×844) 스크린샷 검수(검색 화면/미니플레이어/시트 확장/대기열)
6. **README/.env.example** — 기기 룰·QR·BASE_URL 반영, 구닉네임 설명 제거

## 6. 리스크

- **osascript 견고성**: 앨범 스킵 방식(mute→next track 반복)은 Music.app 응답 지연에 민감. 실제 재생으로 E2E 필수
- **Music.app 로그인**: Apple Music 구독 계정 로그인 상태여야 재생됨
- **QR과 호스트**: IP가 바뀌면 재인쇄 필요 → mDNS 호스트명으로 완화. 호스트를 바꿀 일이 생기면 어드민에서 QR 재생성(1분 작업)
- **iOS 프라이빗 브라우징**: 쿠키가 세션 종료 시 소실 → 당일 운영엔 무해

## 7. PoC 판정 → Track 2 트리거

실제 바에서 2~4주 운영 후 판단:
- 주말 기준 손님 신청 수, QR 스캔 대비 신청 전환율
- 사장님/바텐더 피드백 (운영 부하, 기능 요청)
- "다른 업장도 쓰고 싶어할 것인가" → 긍정이면 `plan-cloud.md` C1 착수
