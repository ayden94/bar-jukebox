import type { DatabaseConnection } from "../infra/db";
import type {
  ArtworkPort,
  ConnectedTarget,
  ProviderDescriptor,
  ServerMusicProvider,
} from "../music/contracts";
import { appleMusicDescriptor } from "../music/providers/apple-music";
import { createAppleMusicServer } from "../music/providers/apple-music/server";
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

export type JukeboxBus = { onChange: typeof onChange; emit: typeof emit };
export class JukeboxBusToken {}

type RuntimeConfig = {
  playbackDisabled: boolean;
  music?: {
    descriptor: ProviderDescriptor;
    provider: ServerMusicProvider & { readonly artwork: ArtworkPort };
  };
};

export type JukeboxRuntime = Awaited<ReturnType<typeof createJukeboxRuntime>>;

// 공급자는 여기서만 선택하고, 도메인은 공통 포트로 조립해요.
export async function createJukeboxRuntime(
  config: RuntimeConfig,
  connection: DatabaseConnection,
) {
  const signal = new AbortController().signal;
  let music = config.music;
  if (!music) {
    const result = await createAppleMusicServer(
      { disabled: config.playbackDisabled },
      signal,
    );
    if (!result.ok)
      throw new Error(`음악 서비스 초기화 실패: ${result.error.code}`);
    music = { descriptor: appleMusicDescriptor, provider: result.value };
  }
  const { descriptor, provider } = music;
  const mode = descriptor.modes.find(
    (entry) => entry.modeId === provider.identity.modeId,
  );
  const required = [
    "canPlayExactTrack",
    "canPause",
    "canResume",
    "canStop",
    "canRestart",
    "canObserveEnd",
  ] as const;
  if (
    descriptor.providerId !== provider.identity.providerId ||
    !mode ||
    required.some((capability) => !mode.capabilities[capability]) ||
    mode.location !== provider.execution.location ||
    provider.execution.location !== "server"
  ) {
    await provider.dispose();
    throw new Error("등록한 음악 서비스와 실행 방식이 일치하지 않아요");
  }
  const database = connection.database;
  const queueRepository = new DrizzleQueueRepository(database);
  const queueService = new QueueService(
    queueRepository,
    provider.identity.providerId,
  );
  const settingsRepository = new SettingsRepository(database);
  const settingsService = new SettingsService(settingsRepository);
  const tableService = new TableService(new TableRepository(database));
  const searchService = new SearchService(
    provider.catalog,
    provider.artwork,
    provider.identity.providerId,
  );
  const stored = await queueRepository.loadNowPlaying();
  queueService.hydrate({
    nowPlaying: stored
      ? {
          song: stored.song,
          startedAt: stored.startedAt,
          status: "reconciliation-required",
          positionSec: 0,
          durationSec: null,
        }
      : null,
    queue: await queueRepository.loadQueue(),
    history: await queueRepository.loadHistory(),
  });
  settingsService.hydrate(await settingsRepository.load());
  let connected: ConnectedTarget | null = null;
  if (!config.playbackDisabled && !queueService.hasProviderConflict()) {
    const targets =
      await provider.execution.runtime.connection.listTargets(signal);
    const target = targets.ok ? targets.value[0] : undefined;
    if (target) {
      const result = await provider.execution.runtime.connection.connect(
        target.ref,
        signal,
      );
      if (
        result.ok &&
        result.value.target.providerId === provider.identity.providerId &&
        result.value.target.modeId === provider.identity.modeId &&
        result.value.target.targetId === target.ref.targetId &&
        result.value.location === "server" &&
        required.every((capability) => result.value.capabilities[capability])
      )
        connected = result.value;
    }
  }
  const playbackService = new PlaybackService(
    queueService,
    provider.execution.runtime.playback,
    connected,
  );
  const sseBroker = new SseBroker();
  const providers = [
    { provide: QueueService, useValue: queueService },
    { provide: SettingsService, useValue: settingsService },
    { provide: TableService, useValue: tableService },
    { provide: SearchService, useValue: searchService },
    { provide: PlaybackService, useValue: playbackService },
    { provide: SseBroker, useValue: sseBroker },
    { provide: JukeboxBusToken, useValue: { onChange, emit } },
  ];
  return {
    database,
    providers,
    queueRepository,
    queueService,
    settingsService,
    searchService,
    playbackService,
    async dispose() {
      try {
        await playbackService.dispose();
      } finally {
        try {
          await provider.dispose();
        } finally {
          connection.client.close();
        }
      }
    },
  };
}
