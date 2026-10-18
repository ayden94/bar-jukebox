# 선택된 MusicKit CSP 검증

`src/main.ts`는 listen 전에 `musicService.getSnapshot().active`를 한 번 읽어요.
이 값은 부팅 설정의 복사본이며 저장 가능한 `nextBoot`가 아니에요.
정확히 `apple-music/musickit`일 때만 아래 추가 권한을 조립해요. 토큰 부재는
모드 선택을 바꾸지 않아요. AppleScript, 잘못된 조합, YouTube 모드는 기존
self 정책을 유지해요. artwork는 계속 `/api/artwork`를 사용해요.

## 허용 목록의 근거

2026-10-18에 아래 Apple 1차 자료와 실제 배포물을 확인했어요.

- 안내: https://developer.apple.com/musickit/
- SDK: https://js-cdn.music.apple.com/musickit/v3/musickit.js
- 실제 SDK 응답: HTTP 200, 614791 UTF-8 bytes.
- SHA-256: `21908b72bdcdeea3ec91fa40b105d0b9a2ba07c2a3fe32ea77edcd26e735012c`

원문을 복사·재호스팅하지 않아요. 아래 식별자는 같은 해시의 배포물에서
각 허용 권한을 다시 찾기 위한 위치 설명이에요. SDK 정적 검사는 실제 계정의
인증·재생 네트워크 관측과 구분해요.

| 지시자 | 추가 값 | 확인 근거 |
| --- | --- | --- |
| script-src | `https://js-cdn.music.apple.com` | 앱 sdk-loader.ts의 공식 v3 URL과 실제 CDN 응답. `sdk-script`는 실제 브라우저 load와 configure 함수 존재까지 검사해요. |
| connect-src | `https://api.music.apple.com` | SDK `_fetchStorefronts`의 기본 API URL과 catalog 요청. |
| connect-src | `https://play.itunes.apple.com` | SDK manifest fetch 허용 origin 목록 `Qi`. |
| connect-src | `https://play-edge.itunes.apple.com` | 같은 manifest fetch origin 목록. |
| connect-src | `https://universal-activity-service.itunes.apple.com` | SDK `PlaybackActivitySender.url`의 production play endpoint. |
| media-src | `blob:` | SDK의 `playableUrl` getter가 MediaSource에 `URL.createObjectURL`을 사용해요. 실제 오디오/DRM 성공은 미검증이에요. |

`worker-src 'self'`를 명시해 추가 script origin이 worker fallback 권한까지
넓히지 않게 해요. 새로운 외부 worker origin은 없어요. `frame-src`는
default-src의 self를 유지해요. 기존 browser README의 인증 origin 후보인
`authorize.music.apple.com`은 확인한 `ServiceSetupView`에서 팝업으로 열리므로
그 후보만으로 iframe 권한을 추가하지 않아요. 인증 후 redirect나 popup 통신
성공은 별도 live gate예요. YouTube는 별도 탭이므로 iframe 권한을 추가하지 않아요.
TV/embed endpoint, Apple 전체 wildcard, `unsafe-eval`은 허용하지 않아요.

theme hash, framework가 전달하는 bootstrap 자산, style/img 정책은 유지해요.
현재 설치된 Fluo 0.3.0은 hydration entry를 self의 외부 module로 보내며
테스트는 실제 HTML의 실행 가능한 inline script마다 SHA-256 허용 여부를
확인하고 React 입력 상태 변경으로 hydration을 검사해요.

## 실행

먼저 저장소의 `bun run build`를 실행해요. 두 시나리오는 기존 빌드의
`dist/server/main.js`를 별도 DB·임시 포트로 시작하며 production 헤더를 수정하거나
SDK를 fixture로 바꾸지 않아요.

```sh
bun tests/music-csp.browser.ts --scenario policy-headers
bun tests/music-csp.browser.ts --scenario sdk-script
```

- `policy-headers`: 외부 네트워크·브라우저 없이 CI에서 실행할 수 있어요.
  MusicKit, AppleScript, invalid-mode, YouTube의 HTTP 200/CSP/inline hash를 검사하고,
  AppleScript에서 MusicKit nextBoot를 저장해도 현재 정책은 그대로이며 재시작
  후에만 바뀌는지 확인해요. 토큰 없는 활성 MusicKit API는 503/no owner예요.
- `sdk-script`: 실제 Apple CDN을 사용하는 수동 실행 gate예요. owned Chrome
  프로필에서 production `/admin/music`의 실제 헤더 아래 script를 append해요.
  load/error/securitypolicyviolation은 append 전에 등록하고 timeout을 둬요.
  MusicKit은 SDK load 및 `typeof MusicKit.configure === "function"`을,
  AppleScript/invalid-mode는 실제 enforced CSP violation을 요구해요.
  MusicKit에서도 unrelated external script는 차단돼야 해요.
  앱이 SDK를 자동 요청하지 않는 상태에서 테스트가 직접 script만 로드해요.
  `configure`, `authorize`, `play`는 호출하지 않고 owner도 생성하지 않아요.
- 알 수 없는 시나리오와 인자 누락은 nonzero예요. CDN 실패는 실제 실패로
  기록하며 mock/skip으로 바꾸지 않아요.

결과는 `.omo/evidence/boot-selected-music-playback/task-13-csp/`의
`policy-headers.json`, `sdk-script.json`, 각 mode screenshot에 남아요.
각 GET의 URL/status/header/HTML hash와 script load/error/CSP 이벤트를 기록해요.
admin token/cookie는 기록하지 않아요. 브라우저는 owned 프로필만 닫고,
서버 종료와 포트/DB 디렉터리 부재를 확인해요.

## 아직 확인하지 않은 범위

실제 개발자 토큰이 없어 configure/Apple 계정 인증, subscription/storefront,
DRM 라이선스, 원격 media CDN, 실제 오디오·자연 종료는 **NOT RUN**이에요.
정적 SDK에서 얻은 connect/media 권한은 해당 live 흐름이 검증됐다는 뜻이 아니에요.
반환된 음원/DRM host는 추정해 추가하지 않았으며 토큰을 제공한 뒤 실재생 gate에서
요청별 근거를 확인해야 해요. 이 검증은 작업 13 전체나 Apple 오디오 완료 증거가 아니에요.
