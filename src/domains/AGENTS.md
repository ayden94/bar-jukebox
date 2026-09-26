# src/domains — 도메인 레이어 (controller/service/repository)

## OVERVIEW
도메인별 폴더(queue/table/settings/search/playback/events/admin/shared)로 나뉜다. 각 도메인은 controller(HTTP 표면) → service(규칙·상태) → repository(drizzle 영속화) 계층을 가진다. shared는 도메인 공용(bus, types, config, Song 조립, 상태 합성)이고 DB 클라이언트·스키마는 src/infra에 둔다.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| 큐 규칙(기기/테이블 곡 수 상한, 중복 트랙, 본인 취소) | queue/queue.service.ts | now-playing은 규칙상 큐와 한 덩어리라 같은 서비스가 관리. 상한 값은 settings에서 관리 (기본 기기 1곡/테이블 5곡, 0은 무제한) |
| 큐/히스토리/재생중 영속화 | queue/queue.repository.ts | 증분 쓰기; fire-and-forget 쓰기는 writeChain으로 직렬화 |
| 설정(요청 중단·공지·곡 수 상한) | settings/ | settings.service → settings.repository upsert |
| 테이블 CRUD·QR URL | table/ | 시크릿 발급은 table.service.create |
| 재생 | playback/playback.service.ts | playSong mute→skip 트릭; waitForTrackEnd가 앨범 자동진행 차단 |
| 곡 검색 | search/search.service.ts | iTunes Search → music:// 앨범 URL |
| SSE | events/ | bus "mutate"/"progress" → SseBroker 깨우기, 25s ping |
| 관리자 API | admin/ | AdminTokenGuard(x-admin-token); 도메인 서비스에 위임하는 facade |
| /api/state·SSE 페이로드 모양 | shared/state-view.ts | composeState로 JukeboxState 모양 유지 (프론트엔드 무변경) |
| 스키마·DB 클라이언트 | src/infra/ | schema.ts(SCHEMA_DDL 포함) + db.ts(libsql) |

## CONVENTIONS (different from parent)
- service·repository는 `@fluojs/*` import 금지(순수 TS). controller만 프레임워크를 안다.
- 서비스 변경은 메모리 우선 반영 후 저장소 기록이 뒤따른다(fire-and-forget, 실패 시 콘솔 로그). bus "mutate"는 SSE 깨우기 신호로 유지된다.
- repository는 drizzle 핸들(`Drizzle` 타입)을 생성자 주입받는다. 저장-복원 round-trip은 :memory: 클라이언트로 실제 SQLite로 검증한다(queue.repository.test.ts).
- DI: 도메인 싱글턴 인스턴스는 providers.ts에서 생성하고, 컨트롤러는 클래스 토큰(`@Inject(QueueService)`)으로 주입받는다. main.ts 부팅 코드는 같은 인스턴스를 직접 import한다.
- DTO는 소속 도메인 폴더의 dto.ts에 둔다. admin 컨트롤러는 위임 대상 도메인의 DTO를 재사용한다. 상속 금지(필드 메타데이터가 부모에 묶임) — 평탄화 유지.
- 테스트는 bun:test + 한국어 이름. 서비스 규칙 테스트는 저장소 가짜를 주입해 순수하게, 레포지토리 테스트는 실제 SQLite로 돌린다.

## ANTI-PATTERNS (THIS PROJECT)
- repository 밖에서 SQLite를 건드리지 않는다. playback 밖에서 Music.app을 건드리지 않는다.
- `@fluojs/drizzle`을 동기 드라이버(drizzle-orm/bun-sqlite)와 쓰지 않는다 — 롤백이 조용히 깨진다; drizzle-orm/libsql만.
- 복원된 now-playing을 다시 재생 시작하지 않는다 — start()가 끝나기를 기다린다.
- 테스트에서 실제 osascript를 실행하지 않는다 — TrackNavigator/VolumeController 가짜 주입(playback.test.ts).
- search는 iTunes 원시 필드를 그대로 반환하지 않는다 — SearchHit으로 셰이핑·trackId 중복 제거.
- 큐 position과 메모리 순서가 어긋나면 reorder(replaceQueuePositions)로 정렬한다 — 수동 position UPDATE 금지.
