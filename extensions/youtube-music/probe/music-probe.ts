export interface MusicPlayer {
  getVideoData(): { video_id?: string; cpn?: string };
  getPlayerState(): number;
  getAdState(): number;
  getLoopVideo(): boolean;
  clearQueue(): void;
  loadVideoById(input: { videoId: string; startSeconds: number }): void;
  pauseVideo(): void;
  playVideo(): void;
  stopVideo(): void;
  addEventListener(name: string, listener: (state: number) => void): void;
  removeEventListener(name: string, listener: (state: number) => void): void;
}

export interface MusicQueue {
  getState(): {
    queue: {
      repeatMode: string;
      autoplay: boolean;
      items: readonly unknown[];
      selectedItemIndex: number;
    };
  };
  dispatch(action: {
    type: "SET_REPEAT" | "SET_AUTOPLAY_ENABLED";
    payload: string | boolean;
  }): void;
  subscribe(listener: () => void): () => void;
}

export interface ProbeBinding {
  runId: string;
  documentId: string;
  attempt: number;
  videoId: string;
  cpn: string;
}

interface ProbeOptions {
  runId: string;
  api: MusicPlayer;
  media: EventTarget &
    Pick<HTMLVideoElement, "paused" | "ended" | "currentTime" | "duration">;
  events: EventTarget;
  queue: MusicQueue;
}

// 개발용 관측기예요. 앱의 owner/명령 프로토콜이나 제품 adapter를 대신하지 않아요.
export function createMusicProbe({
  runId,
  api,
  media,
  events,
  queue,
}: ProbeOptions) {
  if (!runId.trim()) {
    throw new Error("runId가 필요해요");
  }
  const documentId = crypto.randomUUID();
  let attempt = 0;
  let sequence = 0;
  let binding: ProbeBinding | null = null;
  let commandId: string | null = null;
  let pending: (() => void) | null = null;
  let disposed = false;
  let invalidated = false;
  let policyTransition = false;
  let policyOwned = false;
  const originalPolicy = {
    repeatMode: queue.getState().queue.repeatMode,
    autoplay: queue.getState().queue.autoplay,
  };
  const log: (ReturnType<typeof read> & {
    sequence: number;
    type: string;
    trusted: boolean;
    naturalEnd: boolean;
    commandId: string | null;
    binding: ProbeBinding | null;
    invalidated: boolean;
  })[] = [];
  const subscribers = new Set<() => void>();

  function read() {
    const data = api.getVideoData();
    const policy = queue.getState().queue;
    return {
      videoId: data.video_id ?? null,
      cpn: data.cpn ?? null,
      nativeState: api.getPlayerState(),
      paused: media.paused,
      ended: media.ended,
      position: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      adState: api.getAdState(),
      loop: api.getLoopVideo(),
      repeatMode: policy.repeatMode,
      autoplay: policy.autoplay,
      atQueueTail:
        policy.items.length > 0 &&
        policy.selectedItemIndex === policy.items.length - 1,
    };
  }

  function safePolicy(current: ReturnType<typeof read>) {
    return (
      current.repeatMode === "NONE" &&
      current.autoplay === false &&
      current.atQueueTail
    );
  }

  function matches(saved: unknown, current = read()): saved is ProbeBinding {
    if (!saved || typeof saved !== "object" || !binding || invalidated) {
      return false;
    }
    return (
      Object.entries(binding).every(
        ([key, value]) => Reflect.get(saved, key) === value,
      ) &&
      current.videoId === binding.videoId &&
      current.cpn === binding.cpn &&
      current.adState === -1 &&
      safePolicy(current)
    );
  }

  function record(
    type: string,
    trusted = false,
    naturalEnd = false,
    current = read(),
  ): (typeof log)[number] {
    const entry = {
      sequence: ++sequence,
      type,
      trusted,
      naturalEnd,
      commandId,
      binding: binding ? { ...binding } : null,
      invalidated,
      ...current,
    };
    log.push(entry);
    for (const notify of subscribers) {
      notify();
    }
    return entry;
  }

  function onStateChange(state: number) {
    if (binding && !pending && !matches(binding)) {
      invalidated = true;
    }
    // native state=0만으로 완료를 만들지 않아요.
    record(`state:${state}`);
  }

  function onMedia(event: Event) {
    if (event.target !== media) {
      return;
    }
    if (
      !pending &&
      (event.type === "seeking" ||
        event.type === "loadstart" ||
        event.type === "emptied" ||
        event.type === "error")
    ) {
      invalidated = true;
    }
    // 전파 경계에서 한 번 읽은 occurrence/policy만 완료에 사용해요.
    const current = read();
    const naturalEnd =
      event.type === "ended" &&
      event.isTrusted &&
      current.ended &&
      !pending &&
      matches(binding, current) &&
      !current.loop;
    if (event.type === "ended") {
      // native autoplay/repeat는 다음 제품 시도의 소유권이 아니에요.
      invalidated = true;
    }
    record(event.type, event.isTrusted, naturalEnd, current);
  }

  const unsubscribeQueue = queue.subscribe(() => {
    if (
      policyTransition ||
      !policyOwned ||
      (!binding && !pending) ||
      (invalidated && !pending)
    ) {
      return;
    }
    const current = read();
    if (safePolicy(current)) {
      return;
    }
    const canPause =
      !invalidated &&
      current.videoId === binding?.videoId &&
      current.cpn === binding?.cpn &&
      current.adState === -1;
    policyTransition = true;
    invalidated = true;
    try {
      pending?.();
      if (canPause) api.pauseVideo();
      record("interrupted:queue-policy");
    } finally {
      policyTransition = false;
    }
  });

  const eventNames = [
    "playing",
    "pause",
    "seeking",
    "loadstart",
    "emptied",
    "ended",
    "error",
  ];
  api.addEventListener("onStateChange", onStateChange);
  for (const name of eventNames) {
    events.addEventListener(name, onMedia, true);
  }

  async function control(
    kind: "load" | "pause" | "resume" | "restart" | "stop",
    id: string,
    signal: AbortSignal,
    videoId?: string,
  ) {
    if (
      disposed ||
      signal.aborted ||
      pending ||
      policyTransition ||
      !id.trim()
    ) {
      throw new Error("종료·취소·중복 명령 또는 빈 commandId예요");
    }
    if (kind === "load" && !/^[A-Za-z0-9_-]{11}$/.test(videoId ?? "")) {
      throw new Error("정확한 videoId가 필요해요");
    }
    if (kind !== "load" && !matches(binding)) {
      throw new Error("현재 occurrence의 소유권을 확인할 수 없어요");
    }
    const previous = binding;
    const targetId = videoId ?? previous?.videoId;
    const createsOccurrence = kind === "load" || kind === "restart";
    if (createsOccurrence && !read().atQueueTail) {
      throw new Error("Music 대기열의 마지막 항목에서만 실증할 수 있어요");
    }
    commandId = id;
    record(`command:${kind}`);
    return new Promise<ReturnType<typeof record>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        subscribers.delete(check);
        signal.removeEventListener("abort", cancel);
        pending = null;
      };
      const fail = (reason: string) => {
        cleanup();
        invalidated = true;
        reject(new Error(reason));
      };
      const cancel = () => fail("명령이 취소되어 결과를 확정할 수 없어요");
      const check = () => {
        const current = read();
        if (
          current.videoId !== targetId ||
          !current.cpn ||
          current.adState !== -1 ||
          !safePolicy(current)
        ) {
          return;
        }
        const ready =
          kind === "pause"
            ? current.nativeState === 2 && current.paused
            : kind === "stop"
              ? current.paused &&
                !current.ended &&
                [-1, 2, 5].includes(current.nativeState)
              : current.nativeState === 1 && !current.paused;
        if (!ready) {
          return;
        }
        if (createsOccurrence) {
          if (current.cpn === previous?.cpn) {
            return;
          }
          binding = {
            runId,
            documentId,
            attempt: ++attempt,
            videoId: current.videoId,
            cpn: current.cpn,
          };
          invalidated = false;
        } else if (
          current.cpn !== previous?.cpn &&
          !(
            kind === "stop" &&
            log.at(-1)?.type === "emptied" &&
            current.nativeState === 5 &&
            current.duration === null &&
            current.position === 0
          )
        ) {
          fail("명령 중 native occurrence가 바뀌었어요");
          return;
        }
        cleanup();
        const result = record(`confirmed:${kind}`);
        if (kind === "stop") {
          invalidated = true;
        }
        resolve(result);
      };
      pending = cancel;
      subscribers.add(check);
      signal.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => fail("명령 관측 제한 시간을 넘겼어요"), 15_000);
      try {
        if (createsOccurrence) {
          policyTransition = true;
          policyOwned = true;
          try {
            queue.dispatch({ type: "SET_REPEAT", payload: "NONE" });
            queue.dispatch({ type: "SET_AUTOPLAY_ENABLED", payload: false });
          } finally {
            policyTransition = false;
          }
          if (!safePolicy(read())) {
            fail("Music 반복·자동재생 정책을 확인할 수 없어요");
            return;
          }
          // 이전 자동재생에서 남은 gapless successor도 제거해요.
          api.clearQueue();
          api.loadVideoById({ videoId: targetId!, startSeconds: 0 });
        } else if (kind === "pause") {
          api.pauseVideo();
        } else if (kind === "resume") {
          api.playVideo();
        } else {
          api.stopVideo();
        }
      } catch {
        fail("native 명령을 발행한 뒤 결과를 확정할 수 없어요");
      }
    });
  }

  return {
    read,
    log,
    load: (videoId: string, id: string, signal: AbortSignal) =>
      control("load", id, signal, videoId),
    pause: (id: string, signal: AbortSignal) => control("pause", id, signal),
    resume: (id: string, signal: AbortSignal) => control("resume", id, signal),
    restart: (id: string, signal: AbortSignal) =>
      control("restart", id, signal),
    stop: (id: string, signal: AbortSignal) => control("stop", id, signal),
    reconcile(saved: unknown) {
      return !disposed && matches(saved)
        ? {
            status: "match" as const,
            binding: { ...binding! },
            current: read(),
          }
        : { status: "unknown" as const };
    },
    subscribe(notify: () => void) {
      if (disposed) {
        throw new Error("관측기가 종료되었어요");
      }
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    dispose() {
      if (disposed) {
        return;
      }
      pending?.();
      disposed = true;
      invalidated = true;
      api.removeEventListener("onStateChange", onStateChange);
      for (const name of eventNames) {
        events.removeEventListener(name, onMedia, true);
      }
      subscribers.clear();
      unsubscribeQueue();
      if (policyOwned) {
        queue.dispatch({
          type: "SET_REPEAT",
          payload: originalPolicy.repeatMode,
        });
        queue.dispatch({
          type: "SET_AUTOPLAY_ENABLED",
          payload: originalPolicy.autoplay,
        });
      }
    },
  };
}
