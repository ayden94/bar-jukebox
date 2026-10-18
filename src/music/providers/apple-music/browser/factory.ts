import type {
  AuthState,
  BrowserMusicProvider,
  MusicResult,
} from "../../../contracts/index";
import { appleMusicDescriptor } from "../index";
import { MusicKitPlayback } from "./playback";
import {
  abortable,
  isInstance,
  type MusicKitSDK,
  record,
  retireInstance,
} from "./sdk";

export type AppleMusicBrowserOptions = {
  readonly api: (path: string, options?: RequestInit) => Promise<Response>;
};

// MusicKit v3는 문서당 singleton이에요. 취소된 SDK 호출이 끝나기 전 재초기화를 막아요.
let occupied = false;

export async function createMusicKitProvider(
  options: AppleMusicBrowserOptions,
  signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<MusicKitSDK>,
): Promise<MusicResult<BrowserMusicProvider>> {
  signal.throwIfAborted();
  if (occupied) return { ok: false, error: { code: "disconnected" } };
  occupied = true;
  let configured: Promise<unknown> | null = null;
  try {
    const response = await options.api("/api/admin/music/developer-token", {
      signal,
      cache: "no-store",
    });
    signal.throwIfAborted();
    if (!response.ok) {
      occupied = false;
      return {
        ok: false,
        error: {
          code: response.status === 401 ? "auth-required" : "configuration",
        },
      };
    }
    const token: unknown = await response.json();
    if (
      !record(token) ||
      typeof token.developerToken !== "string" ||
      !token.developerToken ||
      token.developerToken.length > 16384
    ) {
      occupied = false;
      return { ok: false, error: { code: "configuration" } };
    }
    signal.throwIfAborted();
    const sdk = await load(
      AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    );
    signal.throwIfAborted();
    configured = sdk.configure({
      developerToken: token.developerToken,
      app: { name: "Bar Jukebox", build: "1" },
    });
    const instance = await abortable(configured, signal);
    signal.throwIfAborted();
    if (!isInstance(instance)) {
      await retireInstance(instance);
      occupied = false;
      return { ok: false, error: { code: "unsupported" } };
    }
    return { ok: true, value: provider(instance, sdk) };
  } catch {
    // SDK가 취소를 지원하지 않으므로 늦은 configure도 회수한 뒤 singleton을 반환해요.
    if (configured) {
      void configured
        .then(retireInstance)
        .catch(() => undefined)
        .finally(() => {
          occupied = false;
        });
    } else occupied = false;
    signal.throwIfAborted();
    return { ok: false, error: { code: "configuration" } };
  }
}

function provider(
  music: import("./sdk").MusicKitInstance,
  sdk: MusicKitSDK,
): BrowserMusicProvider {
  const playback = new MusicKitPlayback(music, sdk);
  const lifetime = new AbortController();
  let disposed: Promise<void> | null = null;
  let authorized = false;
  let authWork: Promise<unknown> = Promise.resolve();
  let authOperation: AbortController | null = null;
  let status: AuthState["status"] = "disconnected";
  const target = {
    providerId: "apple-music",
    modeId: "musickit",
    targetId: "this-browser",
  };
  const getState = (): AuthState => ({
    status: disposed
      ? "disconnected"
      : status === "authorized" && !music.isAuthorized
        ? "reauth-required"
        : status,
    authorization: authorized && music.isAuthorized ? "user" : "none",
    action:
      disposed || status === "authorized"
        ? null
        : {
            kind: "user-gesture",
            label: "Apple Music 구독 계정으로 연결해주세요.",
          },
  });
  return {
    identity: { providerId: "apple-music", modeId: "musickit" },
    auth: {
      getState,
      async connect(signal) {
        signal.throwIfAborted();
        if (disposed || authOperation)
          return { ok: false, error: { code: "disconnected" } };
        status = "connecting";
        const operation = new AbortController();
        authOperation = operation;
        const combined = AbortSignal.any([
          signal,
          lifetime.signal,
          operation.signal,
        ]);
        authWork = (async () => {
          const authorization = await music.authorize();
          combined.throwIfAborted();
          if (
            typeof authorization !== "string" ||
            !authorization ||
            !music.isAuthorized
          )
            return false;
          return await music.hasMusicSubscription();
        })().finally(() => {
          if (authOperation === operation) authOperation = null;
        });
        try {
          const permitted = await abortable(authWork, combined);
          combined.throwIfAborted();
          authorized = permitted === true && music.isAuthorized;
          status = authorized ? "authorized" : "insufficient-permission";
          return authorized
            ? { ok: true, value: getState() }
            : { ok: false, error: { code: "permission-denied" } };
        } catch {
          authorized = false;
          status = "reauth-required";
          signal.throwIfAborted();
          return { ok: false, error: { code: "auth-required" } };
        }
      },
      async disconnect(signal) {
        signal.throwIfAborted();
        authOperation?.abort();
        authorized = false;
        status = "disconnected";
        playback.disconnect();
        try {
          await abortable(
            authWork.catch(() => undefined).then(() => music.unauthorize()),
            signal,
          );
          return { ok: true, value: getState() };
        } catch {
          signal.throwIfAborted();
          return { ok: false, error: { code: "disconnected" } };
        }
      },
    },
    runtime: {
      playback,
      connection: {
        async listTargets(signal) {
          signal.throwIfAborted();
          if (disposed) return { ok: false, error: { code: "disconnected" } };
          if (!authorized || !music.isAuthorized)
            return { ok: false, error: { code: "auth-required" } };
          return {
            ok: true,
            value: [
              {
                ref: target,
                label: "이 브라우저의 Apple Music",
                location: "browser",
              },
            ],
          };
        },
        async connect(selected, signal) {
          signal.throwIfAborted();
          if (disposed) return { ok: false, error: { code: "disconnected" } };
          if (!authorized || !music.isAuthorized)
            return { ok: false, error: { code: "auth-required" } };
          if (
            selected.providerId !== target.providerId ||
            selected.modeId !== target.modeId ||
            selected.targetId !== target.targetId
          )
            return { ok: false, error: { code: "configuration" } };
          music.playbackMode = sdk.PlaybackMode.FULL_PLAYBACK_ONLY;
          const connection = {
            target,
            location: "browser" as const,
            connectionGeneration: crypto.randomUUID(),
            capabilities: appleMusicDescriptor.modes[1].capabilities,
          };
          playback.connect(connection);
          return { ok: true, value: connection };
        },
        async disconnect(signal) {
          signal.throwIfAborted();
          playback.disconnect();
          return { ok: true, value: undefined };
        },
      },
    },
    dispose() {
      if (disposed) return disposed;
      lifetime.abort();
      authorized = false;
      status = "disconnected";
      disposed = (async () => {
        await playback.dispose();
        await authWork.catch(() => undefined);
        // dispose 자체를 stopped 관측으로 발행하지 않아요.
        await retireInstance(music);
        occupied = false;
      })();
      return disposed;
    },
  };
}
