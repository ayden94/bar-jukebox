import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import { DrizzleQueueRepository } from "../queue/queue.repository";
import { QueueService } from "../queue/queue.service";
import type { Song } from "../shared/types";
import type { PlaybackDriver } from "./music.driver";

export async function fixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SCHEMA_DDL);
  const repo = new DrizzleQueueRepository(drizzle(client));
  return {
    client,
    repo,
    queue: new QueueService(repo),
    [Symbol.dispose]: () => client.close(),
  };
}

export function song(id: string): Song {
  return {
    id,
    trackId: id.charCodeAt(0),
    trackName: id,
    artistName: "테스트 가수",
    artworkUrl: "",
    albumUrl: `music://album-${id}`,
    trackNumber: 5,
    durationSec: 200,
    requestedBy: "테이블 1",
    deviceId: `device-${id}`,
    tableId: 1,
    isStaff: true,
    requestedAt: 123,
  };
}

// 시간 대기 대신 정확한 관측/명령 경계에서 테스트가 진행을 허용해요.
export class FakePlayer implements PlaybackDriver {
  state: "playing" | "paused" | "stopped" = "playing";
  positionSec = 0;
  trackId = 1;
  clock = 0;
  readonly calls: string[] = [];

  async play(entry: Song): Promise<void> {
    this.calls.push(`play:${entry.id}`);
    this.trackId = entry.trackId;
    this.positionSec = 0;
    this.state = "playing";
  }
  async stop(): Promise<void> {
    this.calls.push("stop");
    this.state = "stopped";
  }
  async pause(): Promise<void> {
    this.calls.push("pause");
    this.state = "paused";
  }
  async resume(): Promise<void> {
    this.calls.push("resume");
    this.state = "playing";
  }
  async restart(): Promise<void> {
    this.calls.push("restart");
    this.positionSec = 0;
  }
  async currentTrackId(): Promise<number> {
    return this.trackId;
  }
  async playerState(): Promise<"playing" | "paused" | "stopped"> {
    return this.state;
  }
  async position(): Promise<number> {
    return this.positionSec;
  }
  async duration(): Promise<number> {
    return 200;
  }
  now(): number {
    return this.clock;
  }
  async sleep(): Promise<void> {
    throw new Error("테스트는 실제 시간 대기에 의존하지 않아요");
  }
}

export async function seedHistory(queue: QueueService): Promise<void> {
  for (const id of ["z", "a"]) {
    await queue.enqueue(song(id));
    await queue.takeAndStart();
    await queue.finishNowPlaying("done", id);
  }
  await queue.enqueue(song("b"));
  await queue.enqueue(song("c"));
  await queue.takeAndStart();
}
