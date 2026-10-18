import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { armCondition, expectCondition } from "./browser-lifecycle";
import { startMusicHostQA } from "./music-host-qa";
import {
  capture,
  click,
  evidence,
  open,
  state,
} from "./music-setup-browser-helpers";

type SetupScenario = "settings-restart" | "connection-errors";

export async function runSetupScenario(scenario: SetupScenario) {
  await mkdir(evidence, { recursive: true });
  const records: unknown[] = [];
  const options: Parameters<typeof startMusicHostQA>[0][] =
    scenario === "settings-restart"
      ? [{ musicKit: "production", boot: "unlocked", disabled: true }]
      : [
          { musicKit: "production", token: "missing" },
          { musicKit: "fixture", token: "expired" },
          {
            musicKit: "production",
            boot: { providerId: "youtube-music", modeId: "browser-companion" },
          },
          { musicKit: "fixture", token: "valid-fixture" },
        ];
  for (const [index, option] of options.entries()) {
    const qa = await startMusicHostQA(option);
    const views: Bun.WebView[] = [];
    try {
      const view = await open(qa.url);
      views.push(view);
      if (scenario === "settings-restart") {
        const before = (await qa.api("/api/admin/music")).body;
        assert.equal(before.active.modeId, "applescript");
        assert.equal(
          await view.evaluate(
            'document.querySelector("#music-installation").open',
          ),
          false,
        );
        await click(
          view,
          "#music-installation > summary",
          'document.querySelector("#music-installation").open',
        );
        await armCondition(
          view,
          'document.querySelector("#music-mode").value === "musickit"',
        );
        await view.evaluate(`(() => {
          const select = document.querySelector("#music-mode");
          select.value = "musickit";
          select.dispatchEvent(new Event("change", {bubbles: true}));
        })()`);
        await expectCondition(view, "다음 시작 초안 선택");
        await click(
          view,
          'button[type="submit"]',
          'document.querySelector("[data-restart-required]")?.dataset.restartRequired === "true"',
        );
        const saved = (await qa.api("/api/admin/music")).body;
        assert.deepEqual(saved.active, before.active);
        assert.equal(saved.nextBoot.config.modeId, "musickit");
        assert.equal(saved.restartRequired, true);
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.owner,
          null,
        );
        const desktopMobile = await capture(view, "settings-saved");
        await qa.restart();
        await view.navigate(`${qa.url}/admin/music`);
        await armCondition(
          view,
          'document.querySelector("[data-active-mode]")?.dataset.activeMode === "musickit"',
        );
        await expectCondition(view, "재시작 후에만 새 모드 적용");
        const restarted = (await qa.api("/api/admin/music")).body;
        assert.equal(restarted.active.modeId, "musickit");
        assert.equal(restarted.restartRequired, false);
        records.push({
          before,
          saved,
          restarted,
          desktopMobile,
          actualAudio: "NOT RUN: playback disabled for boot-only verification",
        });
      } else if (index < 3) {
        await armCondition(
          view,
          state(index === 2 ? "unavailable" : "installation-required"),
        );
        await expectCondition(view, "서버 사유에 따른 설치/미구현 상태");
        assert.equal(
          await view.evaluate(
            '!!document.querySelector("#browser-music-connect")',
          ),
          false,
        );
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.owner,
          null,
        );
        assert.equal(
          qa.requests.some((request) => request.path.endsWith("/owner")),
          false,
        );
        assert.equal(
          await view.evaluate(
            '!!document.querySelector("script[src*=\\"js-cdn.music.apple.com\\"]")',
          ),
          false,
        );
        records.push({
          case:
            index === 0
              ? "real-missing-token"
              : index === 1
                ? "expired-token"
                : "unimplemented-provider",
          snapshot: (await qa.api("/api/admin/music")).body,
          dimensions: await capture(view, `errors-${index}`),
        });
      } else {
        await armCondition(view, state("connect"));
        await expectCondition(view, "명시적 연결 준비");
        await view.evaluate('window.__musickitQA.authorization = "reject"');
        await click(
          view,
          "#browser-music-connect",
          'document.querySelector("[data-browser-phase]")?.dataset.browserPhase === "unavailable" && document.querySelector("#browser-music-connect")?.disabled === false',
        );
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.owner,
          null,
        );
        assert.equal(
          qa.requests.some((request) => request.path.endsWith("/owner")),
          false,
        );
        await view.evaluate('window.__musickitQA.authorization = "success"');
        await click(view, "#browser-music-connect", state("connected"));
        const owner = (await qa.api("/api/admin/playback/snapshot")).body.owner;
        assert(owner && !owner.released);
        const other = await open(qa.url);
        views.push(other);
        await armCondition(other, state("controller"));
        await expectCondition(other, "다른 정상 재생기는 제어 화면으로 표시");
        assert.equal(
          await other.evaluate(
            '!!document.querySelector("#browser-music-connect")',
          ),
          false,
        );
        assert.equal(
          await other.evaluate("window.__musickitQA.calls.length"),
          0,
        );
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.owner
            .executorSessionId,
          owner.executorSessionId,
        );
        const controller = await capture(other, "controller");
        for (const failure of ["music", "playback"] as const) {
          qa.setFailSnapshot(failure);
          await click(
            view,
            "main > div button",
            `${state("unknown")} && document.querySelector("#browser-music-refresh")?.disabled === false`,
          );
          assert.equal(
            await view.evaluate(
              '!!document.querySelector("#browser-music-connect")',
            ),
            false,
          );
          qa.setFailSnapshot(null);
          await click(view, "#browser-music-refresh", state("connected"));
        }
        records.push({
          case: "auth-retry-controller-freshness",
          owner,
          controller,
        });
        await view.click("section[data-preparation] details > summary");
        await click(view, "#browser-music-disconnect", state("connect"));
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.owner
            .stopConfirmed,
          true,
        );
      }
      for (const view of views)
        assert.deepEqual(await view.evaluate("window.__hostQA.failures"), []);
    } finally {
      for (const view of views) await view[Symbol.asyncDispose]();
      await qa.close();
      records.push({
        cleanup: true,
        url: qa.url,
        directoryRemoved: !(await Bun.file(
          `${qa.directory}/qa.sqlite`,
        ).exists()),
      });
      await Bun.write(
        `${evidence}/${scenario}.json`,
        JSON.stringify(records, null, 2),
      );
    }
  }
  console.info(
    JSON.stringify({
      scenario,
      result: "PASS",
      cases: options.length,
      actualMusicKitAudio: "NOT RUN",
    }),
  );
}
