import { expect, test } from "bun:test";
import {
  advanceThroughAlbum,
  type TrackNavigator,
  type VolumeController,
  withMutedVolume,
} from "./playback.service";

test("waits for each Music.app transition before advancing again", async () => {
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
      if (transitionPending) {
        throw new Error("next track called before transition settled");
      }
      transitionPending = true;
    },
  };

  await advanceThroughAlbum(navigator, 3);

  expect(currentTrack).toBe(4);
});

test("restores the original volume when playback work fails", async () => {
  const volumes: number[] = [];
  const controller: VolumeController = {
    getVolume: async () => 73,
    setVolume: async (volume) => {
      volumes.push(volume);
    },
  };
  let caught: unknown;

  try {
    await withMutedVolume(controller, async () => {
      throw new Error("transition failed");
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect(volumes).toEqual([0, 73]);
});
