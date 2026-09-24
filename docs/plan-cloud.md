# 클라우드 주크박스(SaaS) 전환 계획 (Track 2)

> 2026-09-24 작성. **Track 1(로컬 PoC, `plan-local.md`)이 시장성을 보였을 때 착수하는 계획.**
> 착수 전까지는 설계 참고 자료이며, 코드는 없음. Track 1의 코드가 최대한 이식된다.

## 0. 전제와 트리거

- 착수 조건: 로컬 PoC에서 "다른 업장도 쓰고 싶다"는 신호 확인 (PoC 판정 기준은 plan-local.md §7)
- 스케일 가정: N명의 사장님(테넌트) × 업장별 M개 테이블 × 동시 K명 손님. 초기 목표 10~50 업장
- 손님은 업장 WiFi가 아니라 **일반 인터넷(HTTPS 공개 도메인)**으로 접속. 재생 장비만 업장에 있음

## 1. 핵심 제약 — Apple Music은 클라우드에서 재생할 수 없다

Apple Music API는 카탈로그/메타데이터만 제공한다. 오디오 스트림(HLS)은 Apple이 허가한
클라이언트(Music.app, MusicKit JS/네이티브 SDK)에서만 복호화·재생된다. 즉:

- ❌ AWS 서버가 Apple Music을 직접 틀어줄 수 있는 방법은 없음 (기술적+약관적으로 불가)
- ✅ 재생은 반드시 **업장 현장의 Apple 기기**에서 일어나야 함
- 따라서 구조가 고정됨: **클라우드 = 제어 평면, 업장 = 재생 에지 노드, 손님 = 클라우드 직접 접속**

## 2. 전체 아키텍처

```
[손님 폰]──HTTPS──▶ CloudFront ──▶ ALB ──▶ Fargate (Hono API) ──▶ RDS Postgres
   ▲                                    │   ▲              │
   └─────── SSE (큐 실시간 푸시) ────────┘   │              └── Cognito (사장님 로그인)
                                            │ WSS (명령 ↓ / 상태 ↑, 아웃바운드)
                                  [업장 Mac: 주크박스 에이전트]
                                            │ osascript
                                       Music.app ──▶ 업장 스피커
```

- **손님**: `https://<domain>/t/<tableId>?k=<secret>` QR로 접속 → 검색·신청·큐 보기 (SSE 실시간)
- **사장님/바텐더**: 웹 대시보드 (Cognito 로그인) — 테이블/QR/공지/토글/에이전트 상태
- **에이전트**: 업장 Mac의 데몬. 클라우드에 **아웃바운드 전용** 접속 (업장 방화벽/포트포워딩 불필요)
- **진실의 원본 규칙**: 대기열 순서·테이블·계정 = 클라우드. 재생 위치 = 에이전트 (보고받아 표시만)

## 3. Apple Music 처리 (Track 1 대비 바뀌는 것)

| 항목 | Track 1 (로컬) | Track 2 (클라우드) |
|---|---|---|
| 재생 | 같은 Mac의 server가 osascript | 별도 에이전트가 osascript (코드 재사용) |
| 큐 | 로컬 SQLite | 클라우드 Postgres (에이전트는 캐시) |
| 검색 | iTunes Search API (익명) | **Apple Music API** `/v1/catalog/search` + Developer Token |
| 신원 | 쿠키 bj_did | 동일하되 venue별 네임스페이스 |

- **Developer Token**: 우리 운영사가 Apple Developer Program($99/yr)에서 발급한 팀 키(JWT, ES256) 하나로 전 테넌트 검색을 처리. 응답 캐시(30~60s) + 레이트리밋 필요. Music User Token은 불요 (카탈로그 검색은 공개, 재생은 사장님 Music.app 로그인에 의존)
- **⚠️ 라이선스 리스크 (중요)**: Apple Music 개인 구독 약관은 가정 외 상업적·공개 재생을 금지한다. 바에서 트는 것 자체가 회색지대이고 SaaS는 이를 서비스화하는 것이므로 리스크가 커진다. B2B 라이선스 음악 서비스(예: Soundtrack Your Brand류) 연동을 장기 대안으로 기록. 진행 여부는 사업 판단 필요 (법률 자문 아님)

### 3.1 대안 비교 (참고)

| 옵션 | 평가 |
|---|---|
| **A. 업장 Mac + 에이전트** (채택) | Track 1 코드 재사용 최대, 구독 그대로, 마이그레이션 최소. Mac 상시 켜짐 필요 |
| B. 업장 기기 + MusicKit JS kiosk | 아이패드 등 가능하나 브라우저 탭 상시 필요·autoplay 제한·MUT 필요·개발비↑. Phase 후반 검토 |
| C. 다른 음원(Spotify Connect 등) | 소비자 구독의 상업 이용 제한은 동일. Apple Music 정체성 상실. 보류 |

## 4. 멀티테넌시 데이터 모델 (Postgres)

```
owners      (id, email, name, cognito_sub)
venues      (id, owner_id, name, agent_status, agent_last_seen, created_at)
tables      (id, venue_id, label, secret, created_at)          -- QR 시크릿, 교체 가능
songs       (id, venue_id, table_id, device_id, track_id, track_name, artist_name,
             artwork_url, album_url, track_number, requested_by_label,
             state: queued|playing|done|failed|cancelled, position,
             requested_at, played_at)
devices     (id, venue_id, last_seen)                           -- 손님 쿠키 UUID
settings    (venue_id, key, value)                              -- requests_paused, notice
agents      (venue_id PK, pairing_code, last_heartbeat, version)
```

- 모든 쿼리에 `venue_id` 강제 (레포지토리 레이어 + 격리 테스트). RLS는 Phase C4 옵션
- Track 1의 queue/history 분리를 state 컬럼으로 통합 대신, 이식 단순화를 위해
  **queue/history 분리 유지**도 가능 (position + played_at). 구현 시 결정
- 인덱스: `(venue_id, state, position)`, `(venue_id, track_id)` 중복 체크용

## 5. AWS 인프라 (권장 구성)

| 구성요소 | 선택 | 근거 |
|---|---|---|
| 리전 | ap-northeast-2 (서울) | 업장 위치 |
| 컴퓨팅 | Fargate 1 task 시작 (0.5 vCPU) + ALB | Hono 앱+ SSE/WSS 그대로 호스팅, Dockerfile로 패키징 (oven/bun 이미지) |
| DB | RDS Postgres db.t4g.micro, 단일 AZ 시작 | 관리형, 스케일업만 하면 됨 |
| 정적/CDN | CloudFront (SPA 정적 + /api 프록시, 캐시 off) | HTTPS + 안정 도메인 |
| 실시간 | SSE 인프로세스 브로드캐스트 (task 1개 유지) → task 증설 시 ElastiCache Redis pub/sub (C4) | 초기 10~50 업장 × 수백 SSE는 1 task로 충분 |
| 에이전트 통신 | 같은 Fargate 앱에 WSS 라우트 (ALB WebSocket 지원) | 별도 API GW 불필요 |
| 인증 | Cognito User Pool (이메일) | 사장님 로그인, 자체 구현 회피 |
| 과금 | Stripe Billing (venue당 월 구독) | 빠른 구현 |
| 시크릿/관측 | Secrets Manager, CloudWatch, Sentry | 기본 운영 세트 |
| IaC/CI | CDK 또는 Terraform + GitHub Actions | 재현 가능한 배포 |

비용 감 (초기): ALB ~$16 + Fargate ~$20 + RDS ~$13 + CloudFront/기타 ~$10 ≈ **$60~80/월 고정**.
테넌트 30~50개까지 이 구성으로 커버 가능. SSE 하트비트 25s < ALB idle 60s 설정 필요.

## 6. 에이전트 명세 (Phase C2의 핵심 산출물)

- 패키징: `bun build --compile` 단일 바이너리 (darwin-arm64/x64) + launchd plist (부팅 자동시작)
- 연결: 아웃바운드 WSS. **명령**: `play_next` / `skip` / `queue_sync`. **보고**: `now_playing`(곡+position), `error`, `heartbeat`(10s)
- 재사용: Track 1의 `src/playback.ts` (osascript, mute→트랙스킵, 볼륨 복구) + 재생 루프 그대로. 바뀌는 것은 통신 레이어뿐
- **오프라인 동작**: 마지막 큐 스냅샷을 로컬 보관 → 인터넷이 끊겨도 현재 큐는 계속 재생. 재접속 시 완료/실패를 노래 id(멱등키)와 함께 보고해 클라우드와 정산. 클라우드가 단일 진실 원본이므로 충돌 시 "에이전트는 보고, 클라우드가 확정"
- 페어링: 사장님 대시보드에서 6자리 일회용 코드 발급 → 에이전트 설정에 입력 → agents 테이블 등록
- 업그레이드: C2는 수동 다운로드, C3에서 자동 체크+재시작

## 7. 보안

- 테넌트 격리: venue_id 스코핑 강제 + 격리 테스트 (다른 업장 큐 조회 불가)
- 손님 API: 인증 없음(공개 QR 특성) → 테이블 시크릿 검증 + 기기당 레이트리밋 (예: 분당 신청 N회)
- 사장님: Cognito JWT, 라우트별 role 체크
- 에이전트: 일회용 페어링 코드 → venue 바인딩 토큰, 갱신 가능
- 전 구간 TLS(ACM), 시크릿은 Secrets Manager

## 8. 로드맵

| Phase | 내용 | 완료 기준 | 예상 |
|---|---|---|---|
| C1 멀티테넌트 코어 | Postgres 스키마+레포지토리, owners/venues/tables CRUD, Cognito, Fargate 배포, 도메인+TLS, 손님 UI 클라우드 접속 | 2개 테넌트가 격리된 채 손님 신청 API까지 동작 (재생은 아직) | 2~3주 |
| C2 재생 에이전트 | WSS 프로토콜, 페어링, 오프라인 캐시, launchd, 대시보드에 에이전트 상태 | 실제 업장에서 클라우드 큐 → 현장 스피커 재생 E2E, Mac 재부팅 후 자동 복귀 | 2주 |
| C3 운영화 | Stripe 구독, 온보딩 플로우(회원가입→venue→에이전트 설치→QR 인쇄), 에이전트 자동 업데이트, 알람, 레이트리밋 | 새 사장님이 안내만 보고 30분 내 셋업 완료 | 1~2주 |
| C4 확장 | Redis pub/sub 증설, RLS, 통계 대시보드, 다국어, MusicKit JS(아이패드) 검토 | 50+ 업장 트래픽 처리 | 필요 시 |

## 9. Track 1 → Track 2 코드 이식 매핑

| Track 1 | Track 2 | 변경 |
|---|---|---|
| `src/playback.ts` | 에이전트 바이너리 | 통신 레이어만 추가 (osascript 그대로) |
| `src/state.ts` + `db.ts` | 클라우드 큐 서비스 + Postgres 레포지토리 | SQLite→Postgres, bus→Redis(증설 시) |
| `src/server.ts` 라우트 | 동일 Hono 앱에 venue 스코프 추가 | `/api/*` → `/v/venue_id/api/*` 또는 서브도메인 |
| 손님/어드민 HTML | 동일 (QR URL에 venue 반영) | 최소 수정 |
| 쿠키 bj_did | 동일 | venue별로 키 분리 |

## 10. 착수 전 결정 필요 항목

1. **라이선스 방침** (§3 리스크) — Apple Music 개인 구독 기반 진행 vs B2B 라이선스 검토
2. **Apple Developer Program 가입** ($99/yr) — C1 검색 API 전환에 필요
3. 사장님 인증: Cognito (추천) vs 자체 이메일 OTP
4. 서비스명/도메인, 과금 모델(월 구독가) — C3 전에만 확정되면 됨
