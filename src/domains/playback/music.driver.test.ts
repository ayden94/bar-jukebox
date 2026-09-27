import { expect, spyOn, test } from "bun:test";
import { musicDriver } from "./music.driver";

test("Music 명령보다 먼저 Dock 표시를 금지하고 조회 결과는 그대로 반환해요", async () => {
  let command: string[] = [];
  const fake = new Proxy(Bun.spawn, {
    apply(target, receiver, args) {
      const input = args[0];
      if (
        Array.isArray(input) &&
        input.every((part) => typeof part === "string")
      ) {
        command = input;
      }
      return Reflect.apply(target, receiver, [
        {
          cmd: [process.execPath, "-e", "console.log('paused')"],
          stdout: "pipe",
          stderr: "pipe",
        },
      ]);
    },
  });
  const mocked = spyOn(Bun, "spawn").mockImplementation(fake);
  try {
    expect(await musicDriver.playerState()).toBe("paused");
    const script = command[2] ?? "";
    const policyIndex = script.indexOf("setActivationPolicy:2");
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    expect(policyIndex).toBeLessThan(
      script.indexOf('tell application "Music"'),
    );
  } finally {
    mocked.mockRestore();
  }
});
