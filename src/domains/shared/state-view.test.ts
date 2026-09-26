import { expect, test } from "bun:test";
import { composeState } from "./state-view";
import type { Song } from "./types";

test("공개 상태는 인증 식별자 없이 본인 곡만 구분해요", () => {
  const song: Song = {
    id: "song",
    trackId: 1,
    trackName: "곡",
    artistName: "가수",
    artworkUrl: "",
    albumUrl: "",
    trackNumber: 1,
    durationSec: 200,
    deviceId: "private-device",
    requestedBy: "테이블",
    tableId: 1,
    isStaff: false,
    requestedAt: 0,
  };
  const queue = {
    snapshot: () => ({
      queue: [song],
      history: [song],
      nowPlaying: {
        song,
        status: "playing" as const,
        startedAt: 0,
        positionSec: 0,
        durationSec: 200,
      },
    }),
  };
  const settings = {
    read: () => ({
      notice: "",
      requestsPaused: false,
      maxPerDevice: 1,
      maxPerTable: 5,
    }),
  };
  const mine = composeState(queue, settings, "private-device");
  const others = composeState(queue, settings, "other");
  expect(mine.queue[0]?.isMine).toBe(true);
  expect(others.queue[0]?.isMine).toBe(false);
  expect(JSON.stringify(mine)).not.toContain("deviceId");
  expect(JSON.stringify(mine)).not.toContain("private-device");
});
