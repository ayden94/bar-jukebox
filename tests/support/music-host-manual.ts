import { resolve } from "node:path";
import { startMusicHostQA } from "./music-host-qa";

const qa = await startMusicHostQA();
const evidence = resolve(".omo/evidence/boot-selected-music-playback/task-5");
await Bun.write(
  `${evidence}/manual-resources.json`,
  JSON.stringify(
    {
      url: qa.url,
      directory: qa.directory,
      pid: process.pid,
      provider: "SIMULATED test-radio; no real audio",
    },
    null,
    2,
  ),
);
console.info(`QA_READY ${qa.url}`);
process.once("SIGTERM", async () => {
  await qa.close();
  await Bun.write(
    `${evidence}/manual-cleanup.json`,
    JSON.stringify(
      {
        serverStopped: true,
        directoryRemoved: !(await Bun.file(
          `${qa.directory}/qa.sqlite`,
        ).exists()),
        url: qa.url,
      },
      null,
      2,
    ),
  );
  process.exit(0);
});
