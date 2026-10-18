# YouTube Music 개발용 probe 관측 계약

## 실증 범위

2026-10-18 실제 로그인된 `music.youtube.com`, 클라이언트 `1.20261013.15.00`에서 확인한 진단용 계약이에요. 제품 adapter, 확장 연결, 인증·owner 프로토콜은 구현하지 않아요.

자연 종료는 **Music 대기열의 마지막 항목에서 실제 반복 NONE·자동재생 false를 유지하고, 미리 적재된 native successor를 제거한 경우**에 실증했어요. 다른 대기열 위치에서는 load/restart를 거절해요. 기존 대기열을 삭제하거나 임의로 순서를 바꾸지 않아요. 처음부터 한 곡짜리 Music 페이지를 준비하거나 현재 마지막 항목을 명시적으로 선택해야 해요. 이 준비 조건을 충족하지 못한 연결을 ready로 표시하면 안 돼요.

초기 probe의 반복 false positive와 자동재생 종료 관측 실패는 보존했어요. `getLoopVideo()`만으로 반복 여부를 판단하거나 anonymous state 0을 이전 binding에 붙이는 방식은 사용할 수 없어요.

## 실제 접근 지점

```ts
const app = document.querySelector("ytmusic-app");
const api = document.querySelector("ytmusic-player").getPlayer();
const media = document.querySelector("video");
const queue = app.polymerController.store;

const probe = createMusicProbe({
  runId: "고유한 실행 식별자",
  api,
  media,
  events: window,
  queue,
});
```

위 예시는 확인한 페이지 접근 경로를 보여줘요. 실제 연결 코드는 요소·함수·store와 정책 필드가 존재하는지 확인해야 해요. 다른 페이지나 mock으로 대체하면 안 돼요. 버전 변경이나 shape 불일치는 지원 미확인 상태예요.

- native 관측은 `getVideoData().video_id/cpn`, `getPlayerState()`, `getAdState()`, `getLoopVideo()`예요. cpn은 현재 재생 occurrence의 관측값이며 인증 토큰이나 재시작을 넘는 영구 ID로 사용하지 않아요.
- native 제어는 `loadVideoById({videoId, startSeconds:0})`, `pauseVideo()`, `playVideo()`, `stopVideo()`, `clearQueue()`예요. 마지막 함수는 gapless 재생을 위해 미리 적재된 native successor를 제거해요. Music 앱의 사용자 대기열 목록을 삭제하는 함수로 취급하지 않아요.
- Music 정책은 `queue.getState().queue`의 `repeatMode`, `autoplay`, `items.length`, `selectedItemIndex`만 읽어요. `queue.subscribe()`는 동기적인 store 변경 구독이며 반환 함수를 호출해 해제해요.
- 현재 Music 소스에서 `repeatMode` 값은 `NONE`, `ALL`, `ONE`, `DISABLED`예요. probe는 `NONE`만 허용해요. `autoplay`는 정확히 boolean `false`여야 하며 필드 부재를 false로 추정하지 않아요.
- 정책 제어는 `queue.dispatch({type:"SET_REPEAT",payload:"NONE"})`와 `queue.dispatch({type:"SET_AUTOPLAY_ENABLED",payload:false})`예요. 호출 성공이 아니라 실제 store read-back을 확인한 뒤 preload 제거와 load를 실행해요.
- native 구독은 `addEventListener("onStateChange", listener)`예요. 숫자 상태에는 occurrence ID가 없으므로 0 자체는 완료 증거가 아니에요.
- media 이벤트는 `window` capture에서 `event.target === media`를 확인해요. 현재 media는 document tree 안에 있고 shadow boundary가 없었어요. `playing`, `pause`, `seeking`, `loadstart`, `emptied`, `ended`, `error`를 구독해요. 다른 구조에서 임의로 target을 바꾸지 말고 재실증해야 해요.
- 실제 UI는 `ytmusic-miniplayer`, `ytmusic-wiz-player-controls`, `ytmusic-player-queue`였어요. 이전 `ytmusic-player-bar`는 현재 페이지에 없었어요. 반복 버튼의 접근 가능한 이름은 `반복 사용 안함` → `모두 반복` → `1개 반복`이고 queue 화면에 `자동재생 사용 안함/사용 중`이 나타났어요.

## 명령과 binding

공개 API는 `load(videoId, commandId, signal)`, `pause(commandId, signal)`, `resume(commandId, signal)`, `restart(commandId, signal)`, `stop(commandId, signal)`, `read()`, `reconcile(savedBinding)`, `subscribe(listener)`, `dispose()`예요.

- binding은 `{runId, documentId, attempt, videoId, cpn}`이에요. 모든 로그에 sequence, commandId, binding과 관측 상태가 있어요.
- 명령은 native 호출 전에 구독하고 최대 15초 동안 실제 상태를 기다려요. 취소·timeout·예외는 결과 불명이며 자동 재전송하지 않아요.
- load/restart는 exact ref, 새 cpn, state 1, paused false, 광고 없음과 안전한 Music 정책을 확인해야 확정해요. restart는 같은 ref라도 새 attempt/cpn이에요.
- pause/resume은 같은 occurrence를 유지해요. 이전 restart binding, 수동 변경, seek, 정책 drift, 오류는 unknown이에요.
- stop의 cpn이 바뀌면 해당 명령 중 관측한 `emptied`, state 5, paused true, ended false, duration null, position 0을 함께 요구해요. 다른 occurrence가 일시정지한 것만으로 stop을 확정하지 않아요.
- probe가 정책을 변경한 경우 dispose는 처음 읽은 repeat/autoplay 값만 복원해요. 이벤트/store 구독도 해제해요. dispose 자체는 정지 증거가 아니므로 먼저 실제 정지를 확인해야 해요. 페이지 종료·비정상 종료 후 복원을 보장하지 않아요.

## 종료와 수동 개입

`naturalEnd:true`에는 실제 trusted media ended, media.ended true, 광고 없음, 명령 대기 없음, exact ref/cpn binding, repeat NONE, autoplay false, 대기열 마지막 위치, native loop false가 모두 필요해요. 전파 경계에서 상태를 한 번 읽어 로그에 보존해요. 종료 직후 binding을 무효화한 뒤 구독자에게 알리므로 같은 종료나 native 후속 항목을 다시 소유하지 않아요.

Music 정책이 반복·자동재생 허용 또는 대기열 중간 위치로 바뀌면 store 구독에서 즉시 binding을 무효화하고 `interrupted:queue-policy`를 남겨요. 그 순간 native ref/cpn이 아직 소유한 occurrence이면 pause를 발행해요. 이미 다른 native occurrence이면 그것을 소유한 것으로 가정해 제어하지 않아요. 정책을 다시 끄거나 native를 수동 resume해도 이전 binding은 복구되지 않아요.

실제 검증에서는 다음 결과를 얻었어요.

1. autoplay true에서는 window/document/media의 가장 이른 capture에서도 owned media ended가 없었고, state 0 전에 successor ref/cpn이 노출됐어요. 이 경로는 계속 완료 불명으로 남겨요.
2. 실제 Music autoplay false·repeat NONE·queue tail에서는 처음부터 정상 속도로 재생한 곡이 trusted media ended를 발생시켰고, ref/cpn이 확인된 restart binding과 같았어요. native state 0은 그 뒤에 왔어요.
3. UI repeat ONE에서는 native loop가 false여도 즉시 interruption이 발생했어요. 수동 native resume 뒤 실제 trusted ended와 같은 ref의 새 cpn 반복을 관측했지만 naturalEnd는 모두 false였어요.
4. autoplay를 다시 켜면 실제 native pause가 확인됐어요. 수동 native resume 뒤 successor가 state 0보다 먼저 노출되어도 이전 binding은 unknown이고 naturalEnd는 false였어요.
5. 별도의 owned Get Lucky occurrence에서 Music UI의 On / Off를 수동 선택하자 이전 binding이 unknown이 됐고 완료는 발생하지 않았어요.

시간·duration 도달·position 0·trackId 변화·native state 0으로 ended를 합성하지 않아요. 광고 회피·차단, DRM 변경, 음원 URL 추출은 없었어요. 광고가 나타나지 않아 광고 전환 자체는 실증하지 않았어요.

## 검색과 lookup

기존의 겹치지 않는 실제 검색/lookup 영수증을 재사용했어요. 검색 combobox의 이름은 `노래, 앨범, 아티스트, 팟캐스트 검색`이에요. 입력/Enter 후 실제 결과 anchor의 href를 읽고, native ref/cpn·playing 상태와 진행 시간을 전후 비교했어요.

같은 origin `GET /watch?v=<exact videoId>`는 HTML의 allowlist canonical/title metadata만 읽었어요. 계정 설정·cookie·token·미디어 URL을 수집하지 않았어요. duration은 없으면 null이에요. probe 파일 자체는 catalog 구현을 제공하지 않아요.

직접 native load를 호출하면 Music bar의 제목은 이전 곡으로 남을 수 있어요. bar 텍스트나 요청 URL만으로 exact ref를 증명하지 말고 native videoId를 비교해야 해요. UI 이름이 비슷한 버튼도 있으므로 현재 snapshot의 정확한 대상을 사용해야 해요.

## 증거와 검사

비공개 자료는 `.omo/evidence/boot-selected-music-playback/task-4-resume/`에 있어요. 이전 `native-st_01a14dc6/`와 `dbc-handoff.json`은 실패/소유권 이력을 그대로 보존해요. 이번 `end-proof-st_01a14de2/`에는 이전 방식의 실패, 정책 제어를 바꾼 실제 관측, 수정된 probe의 명령/종료/반복/자동재생/수동 선택 영수증, 스크린샷, 검사와 cleanup 결과를 저장해요.

`bun test extensions/youtube-music/probe`는 결정적인 상태 전이 회귀를 검사해요. 단위 fixture의 trusted 플래그는 실브라우저 증거가 아니에요. 별도로 strict TypeScript, Biome, browser bundle을 확인해요. 개인 fixture와 영수증은 커밋하지 않아요. 전체 제품 CI와 후속 확장·adapter·출력 오디오 검증을 이 진단 gate가 대신하지 않아요.
