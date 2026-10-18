import { expect, test } from "bun:test";
import { createMusicProbe, type MusicPlayer } from "./music-probe";

function fixture() {
  const nativeEndListeners = new Set<EventListenerOrEventListenerObject>();
  class Media extends EventTarget {
    paused = true;
    ended = false;
    currentTime = 0;
    duration = 370;
    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "ended" && listener) nativeEndListeners.add(listener);
      super.addEventListener(type, listener, options);
    }
    override removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "ended" && listener) nativeEndListeners.delete(listener);
      super.removeEventListener(type, listener, options);
    }
  }
  const media = new Media();
  const listeners = new Set<(state: number) => void>();
  let state = -1;
  let cpn = "initial";
  let videoId = "4D7u5KF7SP8";
  let occurrence = 0;
  let nativeNextQueued = true;
  const policy = {
    repeatMode: "NONE",
    autoplay: true,
    items: [{}],
    selectedItemIndex: 0,
  };
  const queueListeners = new Set<() => void>();
  const queue = {
    getState: () => ({ queue: policy }),
    subscribe(listener: () => void) {
      queueListeners.add(listener);
      return () => queueListeners.delete(listener);
    },
    dispatch(action: { type: string; payload: string | boolean }) {
      if (action.type === "SET_REPEAT") {
        policy.repeatMode = String(action.payload);
      } else if (action.type === "SET_AUTOPLAY_ENABLED") {
        policy.autoplay = action.payload === true;
      }
      for (const listener of queueListeners) listener();
    },
  };
  const api: MusicPlayer = {
    getVideoData: () => ({ video_id: videoId, cpn }),
    getPlayerState: () => state,
    getAdState: () => -1,
    getLoopVideo: () => false,
    clearQueue() {
      nativeNextQueued = false;
    },
    loadVideoById(input) {
      videoId = input.videoId;
      cpn = `occurrence-${++occurrence}`;
      state = 1;
      media.paused = false;
      media.currentTime = 0;
      media.duration = 370;
      media.ended = false;
      for (const listener of listeners) listener(state);
    },
    pauseVideo() {
      state = 2;
      media.paused = true;
      for (const listener of listeners) listener(state);
    },
    playVideo() {
      state = 1;
      media.paused = false;
      for (const listener of listeners) listener(state);
    },
    stopVideo() {
      cpn = `stopped-${++occurrence}`;
      state = 5;
      media.paused = true;
      media.currentTime = 0;
      media.duration = Number.NaN;
      media.dispatchEvent(new Event("emptied"));
    },
    addEventListener(_name, listener) {
      listeners.add(listener);
    },
    removeEventListener(_name, listener) {
      listeners.delete(listener);
    },
  };
  const options = { runId: "test-run", api, media, events: media, queue };
  const probe = createMusicProbe({
    ...options,
  });
  return {
    api,
    media,
    probe,
    policy,
    queue,
    end() {
      if (
        policy.repeatMode !== "ONE" &&
        (policy.autoplay || nativeNextQueued)
      ) {
        videoId = "vBtvhPM2GHc";
        cpn = `autoplay-${++occurrence}`;
        for (const listener of listeners) listener(0);
      }
      media.ended = true;
      media.paused = true;
      state = 0;
      // 단위 fixture의 신뢰 플래그예요. 실제 브라우저 실증을 대신하지 않아요.
      const event = new Proxy(new Event("ended"), {
        get(target, property) {
          if (property === "isTrusted") return true;
          if (property === "target") return media;
          return Reflect.get(target, property, target);
        },
      });
      for (const listener of nativeEndListeners) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
      for (const listener of listeners) listener(0);
    },
    signal: new AbortController().signal,
    autoplay() {
      videoId = "vBtvhPM2GHc";
      cpn = `autoplay-${++occurrence}`;
      state = 3;
      media.currentTime = 19.163363;
      media.duration = 39.222;
      for (const listener of listeners) listener(0);
      state = 1;
      for (const listener of listeners) listener(state);
    },
  };
}

test("stop은 native occurrence가 바뀌어도 비워진 정지 상태만 확정해요", async () => {
  const { probe, signal } = fixture();
  const loaded = await probe.load("4D7u5KF7SP8", "load", signal);
  try {
    const stopped = await probe.stop("stop", signal);

    expect(stopped.type).toBe("confirmed:stop");
    expect(stopped.binding).toEqual(loaded.binding);
    expect(stopped.cpn).not.toBe(loaded.cpn);
    expect(stopped.paused).toBe(true);
    expect(stopped.naturalEnd).toBe(false);
    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
  } finally {
    probe.dispose();
  }
});

test("실제 Music 반복이 ONE이면 native loop false여도 완료를 거절해요", async () => {
  const { probe, queue, end, signal } = fixture();
  const loaded = await probe.load("7VYgrfWQ8Ss", "load", signal);
  try {
    queue.dispatch({ type: "SET_REPEAT", payload: "ONE" });
    end();

    expect(probe.log.some((entry) => entry.naturalEnd)).toBe(false);
    expect(
      probe.log.some((entry) => entry.type === "interrupted:queue-policy"),
    ).toBe(true);
    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
  } finally {
    probe.dispose();
  }
});

test("autoplay와 미리 적재된 successor를 제거해야 원래 cpn의 ended를 관측해요", async () => {
  const { probe, policy, end, signal } = fixture();
  const loaded = await probe.load("7VYgrfWQ8Ss", "load", signal);
  try {
    end();

    const completion = probe.log.find((entry) => entry.naturalEnd);
    expect(policy.autoplay).toBe(false);
    expect(completion?.cpn).toBe(loaded.binding?.cpn);
    expect(completion?.binding).toEqual(loaded.binding);
    expect(completion?.trusted).toBe(true);
    expect(probe.log.filter((entry) => entry.naturalEnd)).toHaveLength(1);
  } finally {
    probe.dispose();
  }
});

test("수동 autoplay 변경은 즉시 소유권을 잃고 dispose는 원래 정책을 복원해요", async () => {
  const { probe, queue, policy, media, signal } = fixture();
  const loaded = await probe.load("7VYgrfWQ8Ss", "load", signal);

  queue.dispatch({ type: "SET_AUTOPLAY_ENABLED", payload: true });

  expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
  expect(media.paused).toBe(true);
  probe.dispose();
  expect(policy.autoplay).toBe(true);
  expect(policy.repeatMode).toBe("NONE");
});

test("Music 대기열 중간에서는 다음 항목을 침범하는 load를 거절해요", async () => {
  const { probe, policy, signal } = fixture();
  policy.items.push({});
  try {
    await expect(probe.load("7VYgrfWQ8Ss", "load", signal)).rejects.toThrow();

    expect(probe.log.some((entry) => entry.type === "confirmed:load")).toBe(
      false,
    );
    expect(policy.autoplay).toBe(true);
  } finally {
    probe.dispose();
  }
});

test("Music 정책 쓰기의 실제 read-back이 실패하면 load를 확정하지 않아요", async () => {
  const { probe, queue, signal } = fixture();
  queue.dispatch = () => {};
  try {
    await expect(probe.load("7VYgrfWQ8Ss", "load", signal)).rejects.toThrow();

    expect(probe.log.some((entry) => entry.type === "confirmed:load")).toBe(
      false,
    );
  } finally {
    probe.dispose();
  }
});

test("Music autoplay 필드가 사라지면 false로 추정하지 않고 load를 거절해요", async () => {
  const { probe, queue, policy, signal } = fixture();
  queue.dispatch = () => {
    Reflect.deleteProperty(policy, "autoplay");
  };
  try {
    await expect(probe.load("7VYgrfWQ8Ss", "load", signal)).rejects.toThrow();

    expect(probe.log.some((entry) => entry.type === "confirmed:load")).toBe(
      false,
    );
  } finally {
    probe.dispose();
  }
});

test("cpn이 먼저 바뀐 뒤 도착한 trusted ended를 이전 binding에 붙이지 않아요", async () => {
  const { probe, autoplay, end, signal } = fixture();
  const loaded = await probe.load("7VYgrfWQ8Ss", "load", signal);
  try {
    autoplay();
    end();

    expect(probe.log.find((entry) => entry.type === "ended")?.trusted).toBe(
      true,
    );
    expect(probe.log.some((entry) => entry.naturalEnd)).toBe(false);
    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
  } finally {
    probe.dispose();
  }
});

test("pause와 resume은 같은 occurrence를 유지하고 restart는 이전 binding을 거절해요", async () => {
  const { probe, signal } = fixture();
  const loaded = await probe.load("4D7u5KF7SP8", "load", signal);
  try {
    const paused = await probe.pause("pause", signal);
    const resumed = await probe.resume("resume", signal);
    const restarted = await probe.restart("restart", signal);

    expect(paused.binding).toEqual(loaded.binding);
    expect(resumed.binding).toEqual(loaded.binding);
    expect(restarted.binding?.attempt).toBe(2);
    expect(restarted.cpn).not.toBe(loaded.cpn);
    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
    expect(probe.reconcile(restarted.binding).status).toBe("match");
  } finally {
    probe.dispose();
  }
});

test("수동 곡 변경은 이전 binding과 완료 관측을 무효화해요", async () => {
  const { api, probe, signal } = fixture();
  const loaded = await probe.load("4D7u5KF7SP8", "load", signal);
  try {
    api.loadVideoById({ videoId: "dJqxQzxLbHM", startSeconds: 0 });

    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
    expect(probe.log.some((entry) => entry.naturalEnd)).toBe(false);
  } finally {
    probe.dispose();
  }
});

test("합성 ended 이벤트는 실제 자연 종료로 승격하지 않아요", async () => {
  const { media, probe, signal } = fixture();
  await probe.load("4D7u5KF7SP8", "load", signal);
  try {
    media.ended = true;
    media.dispatchEvent(new Event("ended"));

    expect(probe.log.at(-1)?.type).toBe("ended");
    expect(probe.log.at(-1)?.naturalEnd).toBe(false);
  } finally {
    probe.dispose();
  }
});

test("stop 중 다른 occurrence가 일시정지해도 비워진 증거 없이는 확정하지 않아요", async () => {
  const { api, probe, signal } = fixture();
  const loaded = await probe.load("4D7u5KF7SP8", "load", signal);
  api.stopVideo = () => {
    api.loadVideoById({ videoId: "4D7u5KF7SP8", startSeconds: 0 });
    api.pauseVideo();
  };
  try {
    await expect(probe.stop("stop", signal)).rejects.toThrow();

    expect(probe.log.some((entry) => entry.type === "confirmed:stop")).toBe(
      false,
    );
    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
  } finally {
    probe.dispose();
  }
});

test("autoplay가 새 곡을 먼저 노출한 state 0은 이전 occurrence의 자연 종료가 아니에요", async () => {
  const { autoplay, probe, signal } = fixture();
  const loaded = await probe.load("7VYgrfWQ8Ss", "load", signal);
  try {
    autoplay();

    const boundary = probe.log.find((entry) => entry.type === "state:0");
    expect(boundary?.videoId).toBe("vBtvhPM2GHc");
    expect(boundary?.binding).toEqual(loaded.binding);
    expect(boundary?.ended).toBe(false);
    expect(probe.log.some((entry) => entry.naturalEnd)).toBe(false);
    expect(probe.reconcile(loaded.binding)).toEqual({ status: "unknown" });
  } finally {
    probe.dispose();
  }
});
