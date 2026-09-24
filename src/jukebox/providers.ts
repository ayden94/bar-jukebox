import { emit, onChange } from "./bus";
import * as db from "./db";
import { startPlaybackLoop, stopPlayback } from "./playback";
import { searchMusic } from "./search";
import { SseBroker } from "./sse-broker";
import { state } from "./state";

// 기존 싱글턴 로직을 fluo DI에 제공하기 위한 토큰/프로바이더.
// 로직 자체는 프레임워크 불가지론 순수 TS로 유지된다.

export class JukeboxStateToken {}
export class JukeboxDatabaseToken {}
export class JukeboxBusToken {}
export class MusicSearchToken {}
export class PlaybackToken {}

export type JukeboxDatabase = typeof db;
export type MusicSearch = { searchMusic: typeof searchMusic };
export type Playback = {
  startPlaybackLoop: typeof startPlaybackLoop;
  stopPlayback: typeof stopPlayback;
};
export type JukeboxBus = { onChange: typeof onChange; emit: typeof emit };

export const jukeboxProviders = [
  { provide: JukeboxStateToken, useValue: state },
  { provide: JukeboxDatabaseToken, useValue: db },
  { provide: JukeboxBusToken, useValue: { onChange, emit } },
  { provide: MusicSearchToken, useValue: { searchMusic } },
  { provide: PlaybackToken, useValue: { startPlaybackLoop, stopPlayback } },
  { provide: SseBroker, useValue: new SseBroker() },
];
