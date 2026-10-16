import { expect, test } from "bun:test";
import type {
  ConnectedTarget,
  PlaybackCommand,
  PlaybackPort,
} from "../../music/contracts";
import {
  createContrastingProvider,
  unwrapMusicResult,
} from "../../music/testing";
import type { Song } from "../shared/types";
import { connection, FakePlayer, fixture, song, state } from "./test-support";

async function providerFixture(kind: "local" | "contrasting") {
  const signal = new AbortController().signal;
  let player: PlaybackPort;
  let target: ConnectedTarget;
  let track: Song;
  let deliver: () => void;
  if (kind === "local") {
    const fake = new FakePlayer();
    fake.autoObserve = false;
    player = fake;
    target = connection;
    track = song("a");
    deliver = () => fake.deliver(fake.current);
  } else {
    const fake = createContrastingProvider();
    unwrapMusicResult(await fake.provider.auth.connect(signal));
    const targets = unwrapMusicResult(
      await fake.runtime.connection.listTargets(signal),
    );
    target = unwrapMusicResult(
      await fake.runtime.connection.connect(targets[0]!.ref, signal),
    );
    const page = unwrapMusicResult(
      await fake.provider.catalog.search("", null, signal),
    );
    track = { ...song("a"), ...page.tracks[0]! };
    player = fake.runtime.playback;
    deliver = () => {
      const sequence = fake.controls.pendingSequences().at(-1);
      if (sequence === undefined) throw new Error("전달할 관측이 없어요");
      fake.controls.deliver(sequence);
    };
  }
  const commands: PlaybackCommand[] = [];
  const listeners = new Set<() => void>();
  const port: PlaybackPort = {
    async execute(command, abort) {
      const result = await player.execute(command, abort);
      commands.push(command);
      for (const listener of listeners) listener();
      return result;
    },
    observe: (abort) => player.observe(abort),
    reconcile: (binding, abort) => player.reconcile(binding, abort),
    dispose: () => player.dispose(),
  };
  return {
    port,
    target,
    track,
    commands,
    deliver,
    executed(type: PlaybackCommand["type"], count = 1): Promise<void> {
      const matches = () =>
        commands.filter((c) => c.type === type).length >= count;
      if (matches()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timeout = AbortSignal.timeout(2000);
        const cleanup = () => {
          listeners.delete(listener);
          timeout.removeEventListener("abort", expired);
        };
        const listener = () => {
          if (!matches()) return;
          cleanup();
          resolve();
        };
        const expired = () => {
          cleanup();
          reject(new Error(`명령을 받지 못했어요: ${type}`));
        };
        listeners.add(listener);
        timeout.addEventListener("abort", expired, { once: true });
      });
    },
  };
}

for (const kind of ["local", "contrasting"] as const) {
  test(`${kind} 공급자는 같은 실제 큐와 재생 코어에서 관측 기반 제어를 지켜요`, async () => {
    await using f = await fixture();
    const provider = await providerFixture(kind);
    await f.queue.enqueue(provider.track);
    const accepted = provider.executed("play");
    const { playback } = f.start(provider.port, provider.target);
    await accepted;
    expect(f.queue.snapshot().nowPlaying?.status).toBe("starting");
    const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    provider.deliver();
    await playing;
    expect(f.queue.snapshot().nowPlaying?.durationSec).toBe(
      provider.track.durationSec,
    );

    await playback.pause();
    expect(f.queue.snapshot().nowPlaying?.status).toBe("playing");
    const paused = state(f.queue, (s) => s.nowPlaying?.status === "paused");
    provider.deliver();
    await paused;
    const firstAttempt = provider.commands[0]!.context.attemptId;
    await playback.previous();
    const restarted = state(f.queue, (s) => s.nowPlaying?.status === "paused");
    provider.deliver();
    await restarted;
    const restart = provider.commands.at(-1)!;
    expect(restart.type).toBe("restart");
    expect(restart.context.attemptId).not.toBe(firstAttempt);
    expect(provider.target.capabilities.canSeek).toBe(false);
    await playback.resume();
    const resumed = state(f.queue, (s) => s.nowPlaying?.status === "playing");
    provider.deliver();
    await resumed;
    const stopped = provider.executed("stop");
    const skipping = playback.skip();
    await stopped;
    expect(f.queue.nowPlayingSong()?.id).toBe(provider.track.id);
    expect(await f.repo.loadHistory()).toEqual([]);

    provider.deliver();
    await skipping;

    expect(f.queue.nowPlayingSong()).toBeNull();
    expect(await f.repo.loadHistory()).toEqual([provider.track]);
    expect(provider.commands.map((c) => c.type)).toEqual([
      "play",
      "pause",
      "restart",
      "resume",
      "stop",
    ]);
    const play = provider.commands[0]!;
    if (play.type === "play") {
      expect(play.trackRef).toEqual(provider.track.ref);
    }
  });
}

test("다른 공급자의 역순 관측과 중복 종료는 현재 시도에 한 번만 적용해요", async () => {
  await using f = await fixture();
  const provider = createContrastingProvider();
  const signal = new AbortController().signal;
  unwrapMusicResult(await provider.provider.auth.connect(signal));
  const targets = unwrapMusicResult(
    await provider.runtime.connection.listTargets(signal),
  );
  const target = unwrapMusicResult(
    await provider.runtime.connection.connect(targets[0]!.ref, signal),
  );
  const page = unwrapMusicResult(
    await provider.provider.catalog.search("", null, signal),
  );
  const entry = { ...song("a"), ...page.tracks[0]! };
  await f.queue.enqueue(entry);
  const commands: PlaybackCommand[] = [];
  const accepted = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const port = provider.runtime.playback;
  const execute = port.execute.bind(port);
  port.execute = async (command, abort) => {
    const result = await execute(command, abort);
    commands.push(command);
    if (command.type === "play") accepted.resolve();
    if (command.type === "stop") stopped.resolve();
    return result;
  };
  f.start(port, target);
  await accepted.promise;
  const playing = state(f.queue, (s) => s.nowPlaying?.status === "playing");
  provider.controls.deliver(provider.controls.pendingSequences()[0]!);
  await playing;
  provider.controls.advanceTo(3);
  const older = provider.controls.pendingSequences()[0]!;
  provider.controls.advanceTo(8);
  const newer = provider.controls.pendingSequences()[1]!;
  const progressed = state(f.queue, (s) => s.nowPlaying?.positionSec === 8);
  provider.controls.deliver(newer);
  await progressed;
  provider.controls.deliver(older);
  provider.controls.finishNaturally();
  const ended = provider.controls.pendingSequences()[0]!;
  provider.controls.finishNaturally();
  const duplicate = provider.controls.pendingSequences()[1]!;
  provider.controls.deliver(ended);
  provider.controls.deliver(duplicate);
  await stopped.promise;
  const finished = state(f.queue, (s) => s.nowPlaying === null);

  provider.controls.deliver(provider.controls.pendingSequences().at(-1)!);
  await finished;

  expect(commands.map((c) => c.type)).toEqual(["play", "stop"]);
  expect(await f.repo.loadHistory()).toEqual([entry]);
  expect(entry.ref.trackId).toBe("Mix:Aa/_?한글");
  expect(entry.durationSec).toBeNull();
});
