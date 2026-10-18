import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { armCondition, expectCondition } from "./browser-lifecycle";
import { startMusicHostQA } from "./music-host-qa";
import { verifyMusicKitControls } from "./musickit-controls";

export type MusicKitScenario =
  | "musickit-adapter"
  | "musickit-auth-failure"
  | "musickit-missing-token";
const evidence = resolve(
  process.env.MUSICKIT_QA_EVIDENCE_DIR ??
    ".omo/evidence/boot-selected-music-playback/task-6",
);
const phase = (name: string) =>
  `document.querySelector("[data-browser-phase]")?.dataset.browserPhase === ${JSON.stringify(name)}`;

export async function runMusicKitScenario(scenario: MusicKitScenario) {
  await mkdir(evidence, { recursive: true });
  const failures =
    scenario === "musickit-auth-failure"
      ? (["invalid", "expired", "reject", "cancel", "subscription"] as const)
      : [null];
  const actions: unknown[] = [];
  for (const failure of failures) {
    const qa = await startMusicHostQA({
      musicKit:
        scenario === "musickit-missing-token" ? "production" : "fixture",
      token:
        failure === "invalid" || failure === "expired"
          ? failure
          : "valid-fixture",
    });
    const view = new Bun.WebView({
      backend: { type: "chrome", url: false },
      width: 1280,
      height: 900,
    });
    const capture = async (name: string) => {
      if (process.env.MUSICKIT_QA_REUSE_VISUALS === "1") return;
      await Bun.write(
        `${evidence}/${name}-desktop.png`,
        await view.screenshot(),
      );
      await view.cdp("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await Bun.write(
        `${evidence}/${name}-mobile.png`,
        await view.screenshot(),
      );
    };
    const click = async (selector: string, condition: string) => {
      await armCondition(view, condition);
      await view.click(selector);
      await expectCondition(view, `${scenario}:${selector}`);
      actions.push({ action: "click", selector, failure, result: "PASS" });
    };
    try {
      await view.navigate(`${qa.url}/admin/music`);
      await view.cdp("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await armCondition(view, '!!document.querySelector("#admin-password")');
      await expectCondition(view, "production 로그인 문서");
      await view.click("#admin-password");
      await view.type("qa-local-only");
      await click(
        'button[type="submit"]',
        '!!document.querySelector("#browser-music-connect")',
      );
      assert.equal(
        (await qa.api("/api/admin/playback/snapshot")).body.owner,
        null,
      );
      if (failure === "reject" || failure === "cancel")
        await view.evaluate(
          `window.__musickitQA.authorization = ${JSON.stringify(failure)}`,
        );
      if (failure === "subscription")
        await view.evaluate("window.__musickitQA.subscription = false");
      if (failure || scenario === "musickit-missing-token") {
        await click(
          "#browser-music-connect",
          `${phase("unavailable")} && !document.querySelector("#browser-music-connect").disabled`,
        );
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.owner,
          null,
        );
        assert.equal(
          (await qa.api("/api/admin/music")).body.active.modeId,
          "musickit",
        );
        if (scenario === "musickit-missing-token") {
          assert.equal(
            await view.evaluate(
              '!!document.querySelector("script[src*=\\"js-cdn.music.apple.com\\"]")',
            ),
            false,
          );
          assert.equal(
            await view.evaluate("typeof window.__musickitQA"),
            "undefined",
          );
        } else {
          assert.equal(
            await view.evaluate("window.__musickitQA.listenerCount"),
            0,
          );
          if (failure === "invalid" || failure === "expired")
            assert.equal(
              await view.evaluate("window.__musickitQA.calls.length"),
              0,
            );
          else {
            await click(
              "#browser-music-connect",
              `${phase("unavailable")} && !document.querySelector("#browser-music-connect").disabled`,
            );
            assert.equal(
              await view.evaluate("window.__musickitQA.listenerCount"),
              0,
            );
          }
        }
        await capture(`${scenario}-${failure ?? "default"}`);
      } else {
        await click("#browser-music-connect", phase("connected"));
        const owner = (await qa.api("/api/admin/playback/snapshot")).body.owner;
        assert(owner && !owner.released);
        await view.evaluate("window.__musickitQA.automatic = false");
        await armCondition(
          view,
          'window.__hostQA.requests.some(r => r.path.endsWith("/receipt") && r.body.outcome.status === "accepted")',
        );
        assert.equal(
          (
            await qa.api("/api/admin/add", {
              providerId: "apple-music",
              trackId: "101",
            })
          ).status,
          201,
        );
        await expectCondition(
          view,
          "SDK accepted가 실제 서버 receipt로 전달돼요",
        );
        assert.notEqual(
          (await qa.api("/api/admin/playback/snapshot")).body.attempt.state,
          "playing",
        );
        await armCondition(
          view,
          'window.__hostQA.requests.some(r => r.path.endsWith("/observation") && r.body.observation.state === "playing")',
        );
        await view.evaluate("window.__musickitQA.state(2)");
        await expectCondition(view, "관측 뒤에만 실제 서버 playing을 확정해요");
        assert.equal(
          (await qa.api("/api/admin/playback/snapshot")).body.attempt.state,
          "playing",
        );
        await verifyMusicKitControls(view, qa);
        await capture("musickit-adapter");
        await click("#browser-music-disconnect", phase("disconnected"));
        const released = (await qa.api("/api/admin/playback/snapshot")).body
          .owner;
        assert.equal(released.stopConfirmed, true);
        assert.equal(released.released, true);
        assert.equal(
          await view.evaluate("window.__musickitQA.listenerCount"),
          0,
        );
        assert.equal(
          await view.evaluate(
            'window.__hostQA.requests.some(r => r.path.endsWith("/observation") && r.body.observation.state === "stopped")',
          ),
          true,
        );
      }
      const logs = await view.evaluate(
        "({requests: window.__hostQA.requests, calls: window.__musickitQA?.calls, listeners: window.__musickitQA?.listenerCount, failures: window.__hostQA.failures})",
      );
      assert.deepEqual(await view.evaluate("window.__hostQA.failures"), []);
      assert(!JSON.stringify(logs).includes("SIMULATED-USER-TOKEN"));
      await Bun.write(
        `${evidence}/${scenario}-${failure ?? "default"}.json`,
        JSON.stringify(
          {
            scenario,
            failure,
            result: "PASS",
            boundary:
              scenario === "musickit-missing-token"
                ? "REAL default factory; no token; no SDK initialization"
                : "SIMULATED MusicKit SDK boundary; real production host/server; no Apple audio",
            url: qa.url,
            logs,
          },
          null,
          2,
        ),
      );
    } finally {
      await view[Symbol.asyncDispose]();
      await qa.close();
      actions.push({
        cleanup: true,
        url: qa.url,
        directoryRemoved: !(await Bun.file(
          `${qa.directory}/qa.sqlite`,
        ).exists()),
      });
      await Bun.write(
        `${evidence}/${scenario}-actions.json`,
        JSON.stringify(actions, null, 2),
      );
    }
  }
  console.info(
    JSON.stringify({
      scenario,
      result: "PASS",
      fixture: scenario !== "musickit-missing-token",
      assertions: actions.length,
    }),
  );
}
