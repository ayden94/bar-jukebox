import { afterEach, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import { DrizzleQueueRepository } from "../queue/queue.repository";
import { QueueService } from "../queue/queue.service";
import type { Song } from "../shared/types";
import {
  advanceThroughAlbum,
  type PlaybackDriver,
  PlaybackService,
  type TrackNavigator,
  type VolumeController,
  withMutedVolume,
} from "./playback.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const clients: Client[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(SCHEMA_DDL);
  const repo = new DrizzleQueueRepository(drizzle(client));
  const queue = new QueueService(repo);
  return { client, repo, queue };
}

function song(id: string): Song {
  return {
    id,
    trackId: 1,
    trackName: "테스트 곡",
    artistName: "테스트 가수",
    artworkUrl: "",
    albumUrl: "music://test",
    trackNumber: 1,
    durationSec: 200,
    requestedBy: "바텐더",
    deviceId: null,
    tableId: null,
    isStaff: true,
    requestedAt: 123,
  };
}

function driver(overrides: Partial<PlaybackDriver> = {}): PlaybackDriver {
  return {
    play: async () => undefined,
    stop: async () => undefined,
    currentTrackId: async () => 1,
    playerState: async () => "playing",
    position: async () => 0,
    duration: async () => 200,
    sleep: async () => {
      throw new Error("테스트는 시간 대기에 의존하지 않아요");
    },
    ...overrides,
  };
}

test("각 트랙 전환이 끝난 뒤에 다음 곡으로 넘겨요", async () => {
  let currentTrack = 1;
  let transitionPending = false;
  const navigator: TrackNavigator = {
    currentTrackId: async () => {
      if (transitionPending) {
        transitionPending = false;
        currentTrack += 1;
      }
      return currentTrack;
    },
    nextTrack: async () => {
      if (transitionPending) throw new Error("이전 전환이 끝나지 않았어요");
      transitionPending = true;
    },
  };
  await advanceThroughAlbum(navigator, 3);
  expect(currentTrack).toBe(4);
});

test("재생 작업이 실패해도 원래 음량을 복원해요", async () => {
  const volumes: number[] = [];
  const controller: VolumeController = {
    getVolume: async () => 73,
    setVolume: async (volume) => {
      volumes.push(volume);
    },
  };
  await expect(
    withMutedVolume(controller, async () => {
      throw new Error("전환 실패");
    }),
  ).rejects.toThrow("전환 실패");
  expect(volumes).toEqual([0, 73]);
});

test("큐에서 재생 중으로 저장한 뒤 재생하고 완료도 저장해요", async () => {
  const { repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  const abort = new AbortController();
  const played: string[] = [];
  let stateReads = 0;
  const playback = new PlaybackService(
    queue,
    driver({
      play: async (entry) => {
        expect((await repo.loadNowPlaying())?.song.id).toBe(entry.id);
        expect(await repo.loadQueue()).toEqual([]);
        played.push(entry.id);
      },
      playerState: async () => {
        if (++stateReads === 1) return "playing";
        abort.abort();
        return "stopped";
      },
    }),
  );
  await playback.start(abort.signal);
  expect(played).toEqual(["a"]);
  expect(queue.nowPlayingSong()).toBeNull();
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual(["a"]);
  expect(await repo.loadNowPlaying()).toBeNull();
});

test("복원된 재생 중 곡은 다시 시작하지 않아요", async () => {
  const { repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  await queue.takeAndStart();
  const abort = new AbortController();
  const played: string[] = [];
  const playback = new PlaybackService(
    queue,
    driver({
      play: async (entry) => {
        played.push(entry.id);
      },
      playerState: async () => {
        abort.abort();
        return "stopped";
      },
    }),
  );
  await playback.start(abort.signal);
  expect(played).toEqual([]);
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual(["a"]);
});

test("시작 저장이 실패하면 플레이어에 재생 명령을 보내지 않아요", async () => {
  const { client, repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  await client.execute(
    "CREATE TRIGGER fail_start BEFORE INSERT ON now_playing BEGIN SELECT RAISE(ABORT, '시작 실패'); END",
  );
  const played: string[] = [];
  const playback = new PlaybackService(
    queue,
    driver({
      play: async (entry) => {
        played.push(entry.id);
      },
    }),
  );
  await expect(playback.start()).rejects.toThrow();
  expect(played).toEqual([]);
  expect(queue.snapshot().queue.map((entry) => entry.id)).toEqual(["a"]);
  expect((await repo.loadQueue()).map((entry) => entry.id)).toEqual(["a"]);
});

test("완료 저장 실패를 숨기거나 다음 곡을 시작하지 않아요", async () => {
  const { client, repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  await client.execute(
    "CREATE TRIGGER fail_finish BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '완료 실패'); END",
  );
  const played: string[] = [];
  let stateReads = 0;
  const playback = new PlaybackService(
    queue,
    driver({
      play: async (entry) => {
        played.push(entry.id);
      },
      playerState: async () => (++stateReads === 1 ? "playing" : "stopped"),
    }),
  );
  await expect(playback.start()).rejects.toThrow();
  expect(played).toEqual(["a"]);
  expect(queue.nowPlayingSong()?.id).toBe("a");
  expect((await repo.loadNowPlaying())?.song.id).toBe("a");
  expect(await repo.loadHistory()).toEqual([]);
});

test("동시 건너뛰기는 한 번만 멈추고 늦은 완료는 건너뛴 곡을 기록하지 않아요", async () => {
  const { repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  const waiting = deferred<void>();
  const ended = deferred<"stopped">();
  const abort = new AbortController();
  let stateReads = 0;
  let stops = 0;
  const played: string[] = [];
  const playback = new PlaybackService(
    queue,
    driver({
      play: async (entry) => {
        played.push(entry.id);
      },
      stop: async () => {
        stops += 1;
      },
      playerState: async () => {
        stateReads += 1;
        if (stateReads === 2) {
          waiting.resolve();
          return ended.promise;
        }
        if (stateReads === 4) {
          abort.abort();
          return "stopped";
        }
        return "playing";
      },
    }),
  );
  const running = playback.start(abort.signal);
  await waiting.promise;
  await Promise.all([playback.skip(), playback.skip()]);
  expect(queue.nowPlayingSong()).toBeNull();
  ended.resolve("stopped");
  await running;
  expect(stops).toBe(1);
  expect(played).toEqual(["a", "b"]);
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual(["b"]);
});

test("완료 저장 중 들어온 늦은 건너뛰기는 다음 곡을 멈추지 않아요", async () => {
  const { repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  await queue.enqueue(song("b"));
  const finishing = deferred<void>();
  const release = deferred<void>();
  const finish = repo.finishNowPlaying.bind(repo);
  repo.finishNowPlaying = async (entry, result, max) => {
    if (entry.id === "a") {
      finishing.resolve();
      await release.promise;
    }
    await finish(entry, result, max);
  };
  const abort = new AbortController();
  let stateReads = 0;
  let stops = 0;
  const played: string[] = [];
  const playback = new PlaybackService(
    queue,
    driver({
      play: async (entry) => {
        played.push(entry.id);
      },
      stop: async () => {
        stops += 1;
      },
      playerState: async () => {
        stateReads += 1;
        if (stateReads === 4) abort.abort();
        return stateReads % 2 === 1 ? "playing" : "stopped";
      },
    }),
  );
  const running = playback.start(abort.signal);
  await finishing.promise;
  const skipping = playback.skip();
  release.resolve();
  await skipping;
  await running;
  expect(stops).toBe(0);
  expect(played).toEqual(["a", "b"]);
  expect((await repo.loadHistory()).map((entry) => entry.id)).toEqual([
    "b",
    "a",
  ]);
});

test("재생 준비 중 건너뛰기는 재생 명령 뒤에 실행해요", async () => {
  const { queue } = await fixture();
  await queue.enqueue(song("a"));
  const playing = deferred<void>();
  const release = deferred<void>();
  const skipped = deferred<void>();
  const abort = new AbortController();
  const calls: string[] = [];
  const playback = new PlaybackService(
    queue,
    driver({
      play: async () => {
        calls.push("시작");
        playing.resolve();
        await release.promise;
        calls.push("준비 완료");
      },
      stop: async () => {
        calls.push("정지");
        abort.abort();
      },
      playerState: async () => {
        await skipped.promise;
        return "stopped";
      },
    }),
  );
  const running = playback.start(abort.signal);
  await playing.promise;
  const skipping = playback.skip();
  expect(calls).toEqual(["시작"]);
  release.resolve();
  await skipping;
  skipped.resolve();
  await running;
  expect(calls).toEqual(["시작", "준비 완료", "정지"]);
  expect(queue.nowPlayingSong()).toBeNull();
});

test("정지 실패와 건너뛰기 저장 실패를 호출자에게 전달하고 재시도해요", async () => {
  const { client, repo, queue } = await fixture();
  await queue.enqueue(song("a"));
  await queue.takeAndStart();
  let stops = 0;
  const playback = new PlaybackService(
    queue,
    driver({
      stop: async () => {
        if (++stops === 1) throw new Error("정지 실패");
      },
    }),
  );
  await expect(playback.skip()).rejects.toThrow("정지 실패");
  expect(queue.nowPlayingSong()?.id).toBe("a");
  await client.execute(
    "CREATE TRIGGER fail_skip BEFORE DELETE ON now_playing BEGIN SELECT RAISE(ABORT, '건너뛰기 저장 실패'); END",
  );
  await expect(playback.skip()).rejects.toThrow();
  expect(queue.nowPlayingSong()?.id).toBe("a");
  expect((await repo.loadNowPlaying())?.song.id).toBe("a");
  await client.execute("DROP TRIGGER fail_skip");
  await playback.skip();
  expect(queue.nowPlayingSong()).toBeNull();
  expect(await repo.loadNowPlaying()).toBeNull();
  expect(await repo.loadHistory()).toEqual([]);
});
