# 바 주크박스 (Bar Jukebox)

바에서 손님이 QR로 곡을 신청하면, 바의 Mac에서 Apple Music으로 순서대로 틀어주는 시스템.

## 구성

- **손님 면** (`/?t=<테이블>&k=<시크릿>`): 테이블 QR을 찍으면 뜨는 모바일 페이지. 애플뮤직 스타일 — 곡 검색·신청, 하단 미니플레이어를 탭하면 풀스크린 재생 화면(앨범아트·진행바)과 대기열 확인, 본인 신청 곡 취소.
- **바텐더 면** (`/admin`): 재생중(진행바)/대기열/최근재생, 스킵·삭제·순서조정(드래그)·제한없는 곡 추가, **테이블 & QR 관리**, 곡 신청 일시중지 토글, 공지 메시지, QR 인쇄.
- **재생 루프**: `osascript`로 Music.app을 제어. 큐에서 다음 곡의 앨범을 `music://`로 열고, 재생 중인 앨범의 트랙 전환이 완료될 때마다 확인하면서 요청 곡까지 이동한다. 이동 중에는 Music.app 볼륨을 0으로 만들고 끝난 뒤 원래 볼륨을 복구한다. 재생 위치는 1초 간격으로 손님 화면 진행바에 실시간 반영된다.

## 룰

- **기기당 동시 1곡**: 신원은 닉네임이 아니라 서버가 심는 기기 쿠키(`bj_did`, 1년) 기준. 이 기기에서 신청한 곡이 큐+재생중에 있으면 추가 신청은 409로 차단된다. 곡이 재생되거나 취소되면 다시 신청 가능.
- **중복 방지**: 이미 큐/재생중인 같은 곡은 신청할 수 없다.
- **본인 곡 취소**: 손님은 자기 기기가 신청한 대기 곡을 직접 취소할 수 있다.
- **바텐더 추가 곡은 제한 없음.**

## 테이블 & QR

1. `/admin`에서 테이블 추가 (예: "테이블 1")
2. 각 테이블의 QR은 `http://<서버주소>/?t=<테이블id>&k=<시크릿>` 형태. 시크릿이 있어 URL을 추측할 수 없음
3. "테이블 QR 전체 인쇄"로 인쇄용 페이지 출력 → 테이블에 부착
4. **QR은 한 번 인쇄하면 유지**되는 것이 목표. 서버 주소가 자주 바뀌면 QR을 다 찍어야 하므로, Mac에 고정 호스트명을 권장 (아래 BASE_URL 참고)

## 실행

바의 Mac에서 (Apple Music 구독이 연결된 계정, Music.app 로그인 상태):

```bash
cd bar-jukebox
bun install
cp .env.example .env
# .env의 ADMIN_TOKEN을 긴 랜덤 문자열로 변경
bun run dev
```

- 바텐더용: `http://localhost:5173/admin` — `.env`의 `ADMIN_TOKEN` 사용
- 손님용: 어드민에서 테이블을 만들고 QR 스캔 (같은 WiFi 기기)
- API 흐름 확인: `ADMIN_TOKEN=<토큰> bun test-flow.ts`

### .env

```
ADMIN_TOKEN=긴-랜덤-문자열
PORT=5173
# QR에 들어갈 공개 주소. 미설정 시 LAN IP 자동 감지.
# IP가 바뀌면 QR을 다 찍어야 하니 고정 호스트명(mDNS, 예: barjukebox.local) 권장.
# BASE_URL=http://barjukebox.local:5173
```

## 영속화 & 실시간

- 상태(큐/히스토리/재생중/설정/테이블)는 SQLite(`jukebox.sqlite`)에 저장 — 서버를 재시작해도 큐가 유지되고, 재생 중이던 곡은 다시 틀지 않고 종료만 기다린다.
- 모든 화면은 SSE(`/api/events`)로 즉시 갱신 — 어드민이 순서를 바꾸면 손님 화면에 바로 반영. SSE 실패 시 폴링으로 자동 폴백.

## 개발

```bash
bun test          # 단위 테스트
bun run typecheck # tsc --noEmit
bun run check     # biome check
```

## 로드맵

- Track 1 (로컬, 현재): `docs/plan-local.md`
- Track 2 (클라우드 SaaS, PoC 이후): `docs/plan-cloud.md`
