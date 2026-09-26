import { database } from "../infra/db";
import { SseBroker } from "./events/sse-broker";
import { PlaybackService } from "./playback/playback.service";
import { DrizzleQueueRepository } from "./queue/queue.repository";
import { QueueService } from "./queue/queue.service";
import { SearchService } from "./search/search.service";
import { SettingsRepository } from "./settings/settings.repository";
import { SettingsService } from "./settings/settings.service";
import { emit, onChange } from "./shared/bus";
import { TableRepository } from "./table/table.repository";
import { TableService } from "./table/table.service";

// 도메인 싱글턴 인스턴스. 컨트롤러/페이지 라우터는 DI 토큰으로,
// 부팅 코드(main.ts)는 직접 import로 같은 인스턴스를 사용한다.
export const queueRepository = new DrizzleQueueRepository(database);
export const queueService = new QueueService(queueRepository);
export const settingsRepository = new SettingsRepository(database);
export const settingsService = new SettingsService(settingsRepository);
export const tableRepository = new TableRepository(database);
export const tableService = new TableService(tableRepository);
export const searchService = new SearchService();
export const playbackService = new PlaybackService(queueService);
export const sseBroker = new SseBroker();

export type JukeboxBus = { onChange: typeof onChange; emit: typeof emit };
export class JukeboxBusToken {}

export const jukeboxProviders = [
  { provide: QueueService, useValue: queueService },
  { provide: SettingsService, useValue: settingsService },
  { provide: TableService, useValue: tableService },
  { provide: SearchService, useValue: searchService },
  { provide: PlaybackService, useValue: playbackService },
  { provide: SseBroker, useValue: sseBroker },
  { provide: JukeboxBusToken, useValue: { onChange, emit } },
];
