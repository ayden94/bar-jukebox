# MusicKit 브라우저 경계

`createAppleMusicBrowser({ api }, signal)`은 선택된 `apple-music/musickit`
호스트에서만 호출해요. import나 관리자 페이지 열기만으로 SDK를 로드하지 않아요.
관리자 API의 개발자 토큰을 먼저 읽고, SDK configure 이후 명시적 `auth.connect`
동작에서만 사용자 인증을 요청해요. 사용자 토큰은 반환값·binding·관측·서버 요청·로그에
넣지 않아요. 서버의 503이나 잘못된 응답은 외부 SDK 초기화 전 configuration 오류예요.

## 확인한 Apple 계약

2026-10-18에 Apple이 배포한 v3 SDK `3.2526.0-prerelease.x`를 확인했어요.
배포 URL은 버전 내부에서 갱신될 수 있어 runtime에서 필요한 표면을 검사해요.
SDK 원문을 복사하거나 재호스팅하지 않아요.

- SDK: https://js-cdn.music.apple.com/musickit/v3/musickit.js
- 안내: https://developer.apple.com/musickit/
- v3 문서: https://developer.apple.com/musickit/web/
- instance: https://js-cdn.music.apple.com/musickit/v3/docs/?path=/docs/reference-javascript-musickit-instance--page
- events: https://js-cdn.music.apple.com/musickit/v3/docs/?path=/docs/reference-javascript-events--page
- queue: https://js-cdn.music.apple.com/musickit/v3/docs/?path=/docs/reference-javascript-queue--page
- namespace: https://js-cdn.music.apple.com/musickit/v3/docs/?path=/docs/reference-javascript-musickit--page

SDK SHA-256:
`21908b72bdcdeea3ec91fa40b105d0b9a2ba07c2a3fe32ea77edcd26e735012c`

`configure`, `authorize`, `unauthorize`, `setQueue`, `play`, `pause`, `stop`,
`seekToTime`, `playbackStateDidChange`, `nowPlayingItemDidChange`,
`playbackTimeDidChange`, `queueItemsDidChange`, `mediaPlaybackError`,
`drmUnsupported`, `authorizationStatusDidChange`는 v3 공개 문서에서 확인했어요.
상태 이벤트의 `nowPlayingItem`은 해당 상태를 발생시킨 MediaItem이에요.
실제 SDK는 정지/종료 이벤트 직전에 현재 item을 비우므로 단순한
`nowPlayingItem === undefined`를 정지나 다른 곡으로 해석하지 않아요.

`hasMusicSubscription()`, `autoplayEnabled`, `playbackMode`,
`PlaybackMode.FULL_PLAYBACK_ONLY`는 현재 Apple 배포 SDK의 공개 객체 표면에서
직접 확인했지만 v3 문서 목록에는 설명이 없어요. 이 표면이 없는 SDK는
unsupported로 거절해요. 구독이 없으면 연결하지 않고, full-playback-only를
설정해요. DRM 미지원 이벤트도 관측을 unavailable로 바꾸고 로컬 정지를 시도해요.
`previewOnly = false`만으로 전체 곡 재생이 보장된다고 취급하지 않아요.

## 재생과 관측

- 제품 큐 대신 정확한 catalog song ID 하나만 SDK 큐에 넣어요. storefront를
  추정하거나 제목으로 다른 곡을 찾지 않아요.
- 큐의 실제 MediaItem 객체, 정확한 ID, 연결 세대, 실행기, attempt, 로컬 occurrence를
  함께 묶어요. 같은 곡 재시작도 새 큐 item이어야 하고 이전 binding은 unknown이에요.
  SDK가 item을 재사용하거나 정확한 곡을 반환하지 않으면 성공으로 위장하지 않아요.
- receipt accepted는 SDK 호출이 반환됐다는 뜻이에요. playing/paused/stopped는
  SDK 상태를 별도로 관측해야 해요. 원시 오류나 발행 후 취소는 unknown-outcome이에요.
- paused 준비는 볼륨 0으로 실제 play/pause를 실행하고 paused를 확인한 뒤 원래
  볼륨을 복원해요. 확인 실패 시 소리를 다시 켜거나 paused를 합성하지 않아요.
- repeat/shuffle/autoplay를 끄고, 실제 playing이 관측된 현재 occurrence의
  ended/completed 이벤트만 자연 종료로 확정해요. duration, 위치 0, ID 변경,
  Promise 성공, dispose는 종료나 침묵의 증거가 아니에요.
- 동일 ID라도 다른 객체, 오래된 상태/리스너/명령, 다른 연결·실행기는 현재
  occurrence를 확정하지 못해요. manual 변경은 interrupted/unknown으로 남아요.
- abort/return/dispose는 관측 대기를 닫아요. 취소를 지원하지 않는 SDK 호출은
  늦은 완료까지 회수하고 singleton을 격리해 새 configure와 겹치지 않게 해요.
  SDK 내부 singleton/script 캐시는 문서 수명에 남지만 adapter 리스너는 모두 제거해요.
  정리는 stop/unauthorize를 시도할 뿐 서버 owner 해제를 확인했다고 주장하지 않아요.

## 작업 13 CSP 인계

이 작업은 `src/main.ts` 정책을 변경하지 않아요. 현재 정책은 토큰이 있는 경우에도
외부 SDK를 막으므로 작업 13에서 선택 모드에 한해서 연결해야 해요.
아래는 실제 Apple 배포물에서 확인한 정확한 origin이며, 실인증·음원 네트워크가
검증됐다는 목록은 아니에요.

| 지시자 | origin | 확인 범위 |
| --- | --- | --- |
| script-src | `https://js-cdn.music.apple.com` | 실제 v3 script와 문서 배포 응답 200 |
| connect-src | `https://api.music.apple.com` | SDK catalog/API endpoint |
| connect-src | `https://play.itunes.apple.com` | SDK web playback endpoint |
| connect-src | `https://play-edge.itunes.apple.com` | SDK playback endpoint |
| connect-src | `https://universal-activity-service.itunes.apple.com` | SDK playback activity endpoint |
| frame-src | `https://authorize.music.apple.com` | SDK 사용자 인증 origin |
| media-src | 미확인 | 토큰과 실제 재생 응답 없이 CDN/DRM origin을 추정하지 않아요. |

SDK의 `https://embed.music.apple.com`이나 TV endpoint는 이 adapter가 사용하는
API가 아니므로 허용 목록에 넣지 않아요. 인증 팝업의 후속 redirect,
DRM 라이선스, 실제 media CDN, blob 사용 여부는 live gate에서 요청별로 확인해야 해요.
`*`, 포괄적인 Apple 하위 도메인 wildcard, `unsafe-eval`로 우회하지 않아요.

## 검증 수준

`bun tests/music-modes.browser.ts --scenario musickit-adapter`와
`--scenario musickit-auth-failure`는 실제 production SSR/호스트/owner/대기열을
사용하지만 SDK만 Vite 모듈 경계에서 fixture로 치환해요. 인증·오디오는 모의예요.
`--scenario musickit-missing-token`은 SDK fixture 없이 실제 기본 factory를 실행해
토큰 부재, no owner, no SDK 요청을 확인해요. fixture는 production env/window
registry에 연결되지 않아요.

실제 개발자 토큰이 제공되지 않아 Apple 승인, 계정 storefront의 iTunes catalog ID
호환성, DRM/브라우저 autoplay 정책, 실제 오디오 출력과 live 자연 종료는
**NOT RUN**이에요. 토큰 발급·구매·서명 서비스를 추가하지 않았어요.
외부 토큰 주입 뒤 작업 13 CSP 통합과 live gate가 필요하며, fixture 통과를
실제 Apple Music 재생 검증으로 보고하지 않아요.
