import assert from "node:assert/strict";
import { startServerProcess } from "./server-process";

for (const scenario of ["misleading-success-output", "hung-commands"]) {
  let failure: unknown;
  try {
    await startServerProcess({
      command: [
        process.execPath,
        "-e",
        scenario === "hung-commands"
          ? 'console.error("QA_PID=" + process.pid); Bun.serve({port:0,fetch:()=>new Response("ready")});'
          : 'console.info("ready PASS success"); process.exit(0);',
      ],
      env: process.env,
      timeoutMs: 1000,
    });
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error);
  if (scenario === "hung-commands") {
    assert.match(failure.message, /준비 시간이 초과/);
    const match = /QA_PID=(\d+)/.exec(failure.message);
    assert(match);
    const pid = Number(match[1]);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    console.info(
      JSON.stringify({
        scenario,
        status: "passed",
        assertions: { boundedTimeout: true, processReaped: true, pid },
      }),
    );
  } else {
    assert.match(failure.message, /준비 전에 종료/);
    console.info(
      JSON.stringify({
        scenario,
        status: "passed",
        assertions: { successTextWithoutReadyIpcRejected: true },
      }),
    );
  }
}
