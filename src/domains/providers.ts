import type { DatabaseConnection } from "../infra/db";
import type {
  ArtworkPort,
  ConnectedTarget,
  ProviderDescriptor,
  ServerMusicProvider,
} from "../music/contracts";
import { appleMusicDescriptor } from "../music/providers/apple-music";
import {
  createAppleMusicServer,
  getMusicKitDeveloperToken,
} from "../music/providers/apple-music/server";
import { SseBroker } from "./events/sse-broker";
import { MusicRepository } from "./music/music.repository";
import { MusicService } from "./music/music.service";
import {
  type MusicRegistration,
  resolveMusicBootConfig,
} from "./music/music-config";
import { BrowserPlaybackBridge } from "./playback/browser-playback-bridge";
import { PlaybackRepository } from "./playback/playback.repository";
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

export type RuntimeConfig = {
  playbackDisabled: boolean;
  platform?: string;
  musickitDeveloperToken?: string;
  environment?: { MUSIC_PROVIDER?: string; MUSIC_PLAYBACK_MODE?: string };
  music?: {
    descriptor: ProviderDescriptor;
    provider: ServerMusicProvider & { readonly artwork: ArtworkPort };
  };
};

export type JukeboxRuntime = Awaited<ReturnType<typeof createJukeboxRuntime>>;

export async function createJukeboxRuntime(
  config: RuntimeConfig,
  connection: DatabaseConnection,
) {
  const signal = new AbortController().signal;
  const musickitDeveloperToken = config.musickitDeveloperToken;
  const platform = config.platform ?? process.platform;
  const database = connection.database;
  const musicRepository = new MusicRepository(database);
  const descriptor = config.music?.descriptor ?? appleMusicDescriptor;
  if (
    config.music &&
    descriptor.providerId !== config.music.provider.identity.providerId
  ) {
    await config.music.provider.dispose();
    throw new Error("등록한 음악 서비스와 실행 방식이 일치하지 않아요");
  }
  const registry: MusicRegistration[] = [
    {
      descriptor,
      modes: descriptor.modes.map((mode) => ({
        modeId: mode.modeId,
        displayName: config.music ? mode.modeId : "이 Mac의 Music 앱",
        available: config.music !== undefined || platform === "darwin",
        unavailableReason:
          config.music !== undefined || platform === "darwin"
            ? null
            : "이 재생 방식은 macOS의 Music 앱이 필요해요.",
      })),
    },
  ];
  const boot = resolveMusicBootConfig({
    environment: config.environment ?? {},
    saved: await musicRepository.load(),
    legacyDefault: config.music
      ? config.music.provider.identity
      : platform === "darwin"
        ? { providerId: appleMusicDescriptor.providerId, modeId: "applescript" }
        : null,
    registry,
  });
  let provider:
    | (ServerMusicProvider & { readonly artwork: ArtworkPort })
    | null = null;
  let connectionError: string | null = null;
  if (!boot.issue) {
    if (config.music) {
      provider = config.music.provider;
    } else {
      const created = await createAppleMusicServer(
        { disabled: config.playbackDisabled, platform },
        signal,
      );
      if (created.ok) provider = created.value;
      else
        connectionError = `음악 서비스를 시작할 수 없어요 (${created.error.code})`;
    }
  }
  const mode = descriptor.modes.find(
    (entry) => entry.modeId === boot.active?.modeId,
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
    provider &&
    (descriptor.providerId !== provider.identity.providerId ||
      boot.active?.providerId !== provider.identity.providerId ||
      boot.active.modeId !== provider.identity.modeId ||
      !mode ||
      mode.location !== provider.execution.location ||
      required.some((key) => !mode.capabilities[key]))
  ) {
    await provider.dispose();
    throw new Error("등록한 음악 서비스와 실행 방식이 일치하지 않아요");
  }
  const queueRepository = new DrizzleQueueRepository(database);
  const queueService = new QueueService(
    queueRepository,
    provider?.identity.providerId ?? null,
  );
  const settingsRepository = new SettingsRepository(database);
  const settingsService = new SettingsService(settingsRepository);
  const tableService = new TableService(new TableRepository(database));
  const searchService = new SearchService(
    provider?.catalog ?? null,
    provider?.artwork ?? null,
    provider?.identity.providerId ?? null,
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
  const server =
    provider?.execution.location === "server"
      ? provider.execution.runtime
      : null;
  if (
    provider &&
    server &&
    !config.playbackDisabled &&
    !queueService.hasProviderConflict()
  ) {
    const auth = await provider.auth.connect(signal);
    if (auth.ok) {
      const targets = await server.connection.listTargets(signal);
      const target = targets.ok ? targets.value[0] : undefined;
      if (target) {
        const result = await server.connection.connect(target.ref, signal);
        if (
          result.ok &&
          result.value.target.providerId === provider.identity.providerId &&
          result.value.target.modeId === provider.identity.modeId &&
          result.value.target.targetId === target.ref.targetId &&
          result.value.location === "server" &&
          required.every((key) => result.value.capabilities[key])
        )
          connected = result.value;
        else
          connectionError =
            "재생 기기를 연결하지 못했어요. 음악 앱 권한을 확인한 뒤 서버를 다시 시작해주세요.";
      }
    } else connectionError = `음악 권한을 확인해주세요 (${auth.error.code})`;
  }
  const bridge = new BrowserPlaybackBridge();
  const playbackRepository = new PlaybackRepository(database);
  const playbackService = new PlaybackService(
    queueService,
    server?.playback ?? bridge,
    connected,
    playbackRepository,
    {
      onOwnerChange: (owner) => bridge.bindOwner(owner),
      ...(provider && server && !config.playbackDisabled
        ? { serverMode: provider.identity, serverConnection: server.connection }
        : {}),
      ...(provider?.execution.location === "browser" && !config.playbackDisabled
        ? { browserMode: provider.identity }
        : {}),
    },
  );
  const authPort = provider?.auth;
  const musicService = new MusicService(musicRepository, {
    boot,
    registry,
    playbackDisabled: config.playbackDisabled,
    runtime: {
      ...(boot.active?.providerId === "apple-music" &&
      boot.active.modeId === "musickit"
        ? {
            getDeveloperToken: () =>
              getMusicKitDeveloperToken(musickitDeveloperToken),
          }
        : {}),
      async getState() {
        const snapshot = await playbackService.snapshot();
        const owner =
          snapshot.owner && !snapshot.owner.released ? snapshot.owner : null;
        const auth = provider?.auth.getState() ?? null;
        const conflict = queueService.hasProviderConflict();
        return {
          readiness: conflict
            ? "conflict"
            : snapshot.ownerConnected
              ? "ready"
              : auth && auth.status !== "authorized"
                ? "auth-required"
                : "unavailable",
          reason: conflict
            ? "저장된 활성 신청과 선택된 음악 서비스가 달라요."
            : (connectionError ??
              (snapshot.ownerConnected
                ? null
                : auth?.action?.kind === "user-gesture"
                  ? auth.action.label
                  : "재생 기기가 선택되지 않았거나 연결을 확인할 수 없어요.")),
          auth,
          connectedTarget: snapshot.ownerConnected
            ? (owner?.connection ?? null)
            : null,
          owner: owner
            ? {
                executorSessionId: owner.executorSessionId,
                location: owner.connection.location,
                expiresAt:
                  owner.connection.location === "browser"
                    ? owner.heartbeatAt + 15000
                    : null,
              }
            : null,
        };
      },
      ...(authPort
        ? {
            connectAuth: (signal: AbortSignal) => authPort.connect(signal),
            disconnectAuth: async (signal: AbortSignal) => {
              if (server) {
                const result = await playbackService.disconnectTarget(signal);
                if (!result.ok) return result;
              } else {
                const snapshot = await playbackService.snapshot();
                if (snapshot.owner && !snapshot.owner.released) {
                  await playbackService.releaseOwner(snapshot.owner);
                }
              }
              return authPort.disconnect(signal);
            },
          }
        : {}),
      ...(server
        ? {
            listTargets: (signal: AbortSignal) =>
              server.connection.listTargets(signal),
            connectTarget: async (target, signal) => {
              const result = await playbackService.connectTarget(
                target,
                signal,
              );
              if (result.ok) connectionError = null;
              return result;
            },
            disconnectTarget: (signal) =>
              playbackService.disconnectTarget(signal),
          }
        : {}),
    },
  });
  const sseBroker = new SseBroker();
  const providers = [
    { provide: QueueService, useValue: queueService },
    { provide: SettingsService, useValue: settingsService },
    { provide: TableService, useValue: tableService },
    { provide: SearchService, useValue: searchService },
    { provide: PlaybackService, useValue: playbackService },
    { provide: BrowserPlaybackBridge, useValue: bridge },
    { provide: MusicService, useValue: musicService },
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
    playbackRepository,
    musicService,
    bridge,
    async dispose() {
      try {
        await playbackService.dispose();
        await bridge.dispose();
      } finally {
        try {
          await provider?.dispose();
        } finally {
          connection.client.close();
        }
      }
    },
  };
}
