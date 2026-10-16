import { expect, test } from "bun:test";
import type { Song } from "../shared/types";
import { decodePersistedSong } from "./persisted-song";

const song: Song = {
  formatVersion: 1,
  id: "신청-UUID",
  ref: { providerId: "other-provider", trackId: "00A:a/B" },
  title: "테스트 곡",
  artist: "가수",
  durationSec: 0,
  artwork: { providerId: "other-provider", artworkId: "cover:00A" },
  sourceUrl: null,
  requestedBy: "신청자",
  deviceId: "기기",
  tableId: 1,
  isStaff: false,
  requestedAt: 0,
};

test("v1 복원은 불투명 문자열 식별자와 0초 길이와 소유권을 그대로 보존해요", () => {
  expect(decodePersistedSong(JSON.stringify(song), "queue", song.id)).toEqual(
    song,
  );
});

test("v1 복원은 알 수 없는 native 자료와 비밀을 공통 곡에 포함하지 않아요", () => {
  const stored = {
    ...song,
    ref: { ...song.ref, token: "비밀" },
    artwork: { ...song.artwork, token: "비밀" },
    albumUrl: "music://legacy",
    trackNumber: 1,
    token: "비밀",
  };

  expect(decodePersistedSong(JSON.stringify(stored), "queue", song.id)).toEqual(
    song,
  );
});

test("v1 복원은 명시적 이전 없이 구형 숫자 곡을 읽지 않아요", () => {
  const { formatVersion: _, ...old } = song;

  expect(() =>
    decodePersistedSong(JSON.stringify(old), "queue", song.id),
  ).toThrow();
});
