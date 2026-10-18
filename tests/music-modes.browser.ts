import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { PlaybackSnapshot } from "../src/domains/playback/protocol";
import { armCondition, expectCondition } from "./support/browser-lifecycle";
import { startMusicHostQA } from "./support/music-host-qa";

const supported = ["persistent-host", "duplicate-tab"] as const;
const args = process.argv.slice(2);
if (
  args.length !== 0 &&
  (args.length !== 2 ||
    args[0] !== "--scenario" ||
    !supported.some((id) => id === args[1]))
)
  throw new Error(`알 수 없는 scenario: ${args.join(" ")}`);
const scenarios = args.length
  ? supported.filter((id) => id === args[1])
  : supported;
const evidence = resolve(".omo/evidence/boot-selected-music-playback/task-5");
await mkdir(evidence, { recursive: true });
const qa = await startMusicHostQA();
const views: Bun.WebView[] = [];
const actions: unknown[] = [];
let activeScenario: string | null = null;
const phase = (value: string) =>
  `document.querySelector("[data-browser-phase]")?.dataset.browserPhase === ${JSON.stringify(value)}`;

async function snapshot(): Promise<PlaybackSnapshot> {
  const result = await qa.api("/api/admin/playback/snapshot");
  assert.equal(result.status, 200);
  return result.body;
}

async function click(
  view: Bun.WebView,
  selector: string,
  condition: string,
  label: string,
) {
  await armCondition(view, condition);
  await view.click(selector);
  await expectCondition(view, label);
  actions.push({ action: "click", selector, assertion: label, result: "PASS" });
}

async function open(width = 1280, height = 900) {
  const view = new Bun.WebView({
    backend: { type: "chrome", url: false },
    width,
    height,
  });
  views.push(view);
  await view.navigate(`${qa.url}/admin/music`);
  await view.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width === 390,
  });
  await armCondition(
    view,
    '!!document.querySelector("#admin-password") || !!document.querySelector("#browser-music-connect")',
  );
  await expectCondition(view, "production 문서가 표시돼요");
  if (await view.evaluate('!localStorage.getItem("bj_admin")')) {
    await armCondition(
      view,
      "document.querySelector('button[type=\"submit\"]')?.disabled === false",
    );
    await view.click("#admin-password");
    await view.type("qa-local-only");
    await expectCondition(view, "관리자 입력이 실제 폼 상태에 반영돼요");
    await click(
      view,
      'button[type="submit"]',
      '!!document.querySelector("#browser-music-connect")',
      "관리자 인증 후 선택된 브라우저 연결 제어가 보여요",
    );
  }
  await armCondition(
    view,
    '!!window.__hostQA && !!document.querySelector("#browser-music-connect")',
  );
  await expectCondition(view, "QA 관측과 실제 연결 제어가 준비돼요");
  return view;
}

async function connect(view: Bun.WebView) {
  await click(
    view,
    "#browser-music-connect",
    `${phase("connected")} && !document.querySelector("#browser-music-disconnect").disabled`,
    "명시적 연결 후에만 이 문서가 owner가 돼요",
  );
  const current = await snapshot();
  assert(current.owner && !current.owner.released);
  return current;
}

async function disconnect(view: Bun.WebView) {
  await click(
    view,
    "#browser-music-disconnect",
    `${phase("disconnected")} && !document.querySelector("#browser-music-connect").disabled`,
    "정지 관측과 서버 해제 뒤에만 연결 해제를 표시해요",
  );
  const current = await snapshot();
  assert.equal(current.owner?.released, true);
  assert.equal(current.owner?.stopConfirmed, true);
  assert.equal(
    await view.evaluate("window.__hostQA.provider.at(-1)?.action"),
    "disposed",
  );
  return current;
}

async function recover(view: Bun.WebView) {
  const before = await snapshot();
  assert(before.owner && !before.owner.released);
  const reads = await view.evaluate<number>(
    'window.__hostQA.requests.filter(r => r.path === "/api/admin/playback/snapshot").length',
  );
  await click(
    view,
    "#browser-music-refresh",
    `window.__hostQA.requests.filter(r => r.path === "/api/admin/playback/snapshot").length > ${reads} && !!document.querySelector("#browser-music-stopped") && !document.querySelector("#browser-music-refresh").disabled`,
    "미확인 owner의 현재 복구 fence를 읽어요",
  );
  await click(
    view,
    "#browser-music-stopped",
    'document.querySelector("#browser-music-recover")?.disabled === false',
    "새로 읽은 fence에 대해서만 실제 정지를 확인해요",
  );
  await click(
    view,
    "#browser-music-recover",
    '!document.querySelector("#browser-music-stopped") && !document.querySelector("#browser-music-connect").disabled',
    "실제 정지 확인은 browser 전용 복구 계약으로 권한을 해제해요",
  );
  const request = qa.requests
    .filter((request) => request.path.endsWith("/confirm-browser-stopped"))
    .at(-1);
  assert.deepEqual(request?.body, {
    ownerEpoch: before.owner.ownerEpoch,
    executorSessionId: before.owner.executorSessionId,
    attemptId: before.attempt?.attemptId ?? null,
    songId: before.attempt?.songId ?? null,
  });
  const after = await snapshot();
  assert.equal(after.owner?.released, true);
  assert.equal(after.owner?.stopConfirmed, true);
  return { before, after, request };
}

try {
  await Bun.write(
    `${evidence}/resources.json`,
    JSON.stringify(
      {
        provider: "SIMULATED test-radio; no real audio",
        url: qa.url,
        directory: qa.directory,
      },
      null,
      2,
    ),
  );
  for (const scenario of scenarios) {
    activeScenario = scenario;
    const first = await open();
    assert.equal(await first.evaluate("window.__hostQA.provider.length"), 0);
    const initial = await snapshot();
    assert(
      !initial.owner || initial.owner.released,
      "페이지를 열기만 해서는 owner를 요청하지 않아요",
    );
    const owned = await connect(first);
    const id = owned.owner!.executorSessionId;
    if (scenario === "persistent-host") {
      await first.evaluate("window.__documentMarker = crypto.randomUUID()");
      const marker = await first.evaluate("window.__documentMarker");
      await click(
        first,
        'a[href="/admin/qr"]',
        'location.pathname === "/admin/qr" && !!document.querySelector("main h1")',
        "내부 QR 이동은 같은 문서와 호스트를 유지해요",
      );
      assert.equal(await first.evaluate("window.__documentMarker"), marker);
      assert.equal((await snapshot()).owner?.executorSessionId, id);
      assert.equal(
        await first.evaluate(
          'window.__hostQA.provider.filter(e => e.action === "created").length',
        ),
        1,
      );
      await Bun.write(`${evidence}/qr-desktop.png`, await first.screenshot());
      await click(
        first,
        'a[href="/admin/music"]',
        phase("connected"),
        "음악 연결로 돌아와도 같은 실행기를 유지해요",
      );
      await Bun.write(`${evidence}/desktop.png`, await first.screenshot());
      const mobile = await open(390, 844);
      assert.equal(await mobile.evaluate("window.__hostQA.provider.length"), 0);
      await Bun.write(`${evidence}/mobile.png`, await mobile.screenshot());
      await disconnect(first);

      const idle = await connect(first);
      await first.navigate(`${qa.url}/admin/music`);
      await armCondition(
        first,
        '!!document.querySelector("#browser-music-connect") && !!window.__hostQA',
      );
      await expectCondition(first, "reload 문서는 자동 연결하지 않아요");
      assert.equal(
        (await snapshot()).owner?.executorSessionId,
        idle.owner?.executorSessionId,
      );
      assert.equal((await snapshot()).owner?.released, false);
      assert.equal(await first.evaluate("window.__hostQA.provider.length"), 0);
      const recovery = await recover(first);
      assert.equal(recovery.request?.body.attemptId, null);
      assert.equal(recovery.request?.body.songId, null);
      await Bun.write(
        `${evidence}/${scenario}.json`,
        JSON.stringify(
          {
            scenario,
            result: "PASS",
            fixture: "SIMULATED provider; production SSR/admin routes",
            owner: id,
            markerPreserved: true,
            recovery,
          },
          null,
          2,
        ),
      );
    } else {
      const second = await open();
      await click(
        second,
        "#browser-music-connect",
        `${phase("unknown")} && !document.querySelector("#browser-music-connect").disabled`,
        "두 번째 문서는 기존 owner를 빼앗지 못해요",
      );
      assert.equal((await snapshot()).owner?.executorSessionId, id);
      assert.equal(
        await second.evaluate(
          'window.__hostQA.provider.some(e => e.action === "command")',
        ),
        false,
      );
      await Bun.write(
        `${evidence}/duplicate-tab.png`,
        await second.screenshot(),
      );
      await armCondition(
        first,
        'window.__hostQA.requests.some(r => r.path === "/api/admin/playback/observation" && r.status === 201 && r.body.observation.state === "playing")',
      );
      assert.equal(
        (
          await qa.api("/api/admin/add", {
            providerId: "test-radio",
            trackId: "Mix:Aa/_?한글",
          })
        ).status,
        201,
      );
      await expectCondition(first, "fixture 재생 관측이 실제 서버로 전달돼요");
      const playing = await snapshot();
      assert.equal(playing.attempt?.state, "playing");
      await disconnect(first);
      const afterRelease = await snapshot();
      assert.equal(afterRelease.owner?.released, true);
      assert.equal(
        await first.evaluate(
          'window.__hostQA.provider.some(e => e.action === "observation" && e.detail.state === "stopped")',
        ),
        true,
      );
      const next = await connect(second);
      assert(next.owner!.ownerEpoch > owned.owner!.ownerEpoch);
      qa.setFailRelease(true);
      await click(
        second,
        "#browser-music-disconnect",
        `${phase("unknown")} && !document.querySelector("#browser-music-connect").disabled`,
        "해제 실패는 disconnected나 성공으로 바꾸지 않아요",
      );
      qa.setFailRelease(false);
      assert.equal((await snapshot()).owner?.released, false);
      const failedRelease = await recover(second);
      const again = await connect(first);
      const reports = await first.evaluate<number>(
        'window.__hostQA.requests.filter(r => r.path === "/api/admin/playback/observation" && r.status === 201 && r.body.observation.state === "playing").length',
      );
      await armCondition(
        first,
        `window.__hostQA.requests.filter(r => r.path === "/api/admin/playback/observation" && r.status === 201 && r.body.observation.state === "playing").length > ${reports}`,
      );
      assert.equal(
        (
          await qa.api("/api/admin/add", {
            providerId: "test-radio",
            trackId: "mix:aa/_?한글",
          })
        ).status,
        201,
      );
      await expectCondition(
        first,
        "다시 연결한 문서의 재생 관측을 서버가 확정해요",
      );
      assert.equal(
        (
          await qa.api("/api/admin/add", {
            providerId: "test-radio",
            trackId: "Mix:Aa/_?한글",
          })
        ).status,
        201,
      );
      await armCondition(
        first,
        'window.__hostQA.publicState?.nowPlaying?.status === "reconciliation-required"',
        20000,
      );
      const channel = qa.streams.get(again.owner!.executorSessionId);
      assert(channel, "실제 SSE 연결이 열려 있어야 해요");
      channel.abort();
      await expectCondition(
        first,
        "실제 lease 만료는 정지가 아닌 확인 필요 상태를 전달해요",
      );
      assert.equal(await first.evaluate(phase("unknown")), true);
      assert.equal((await snapshot()).owner?.released, false);
      const lostChannel = await recover(first);
      assert(
        lostChannel.request?.body.attemptId && lostChannel.request?.body.songId,
      );
      const preserved = await qa.api("/api/state");
      assert.equal(preserved.body.nowPlaying, null);
      assert.equal(preserved.body.queue.length, 1);
      await Bun.write(
        `${evidence}/${scenario}.json`,
        JSON.stringify(
          {
            scenario,
            result: "PASS",
            fixture: "SIMULATED provider; production SSR/admin routes",
            originalOwner: id,
            playing,
            afterRelease,
            failedRelease,
            lostChannel,
            preserved: preserved.body,
          },
          null,
          2,
        ),
      );
    }
    for (const view of views) {
      assert.deepEqual(await view.evaluate("window.__hostQA.failures"), []);
    }
    console.info(
      JSON.stringify({
        scenario,
        result: "PASS",
        fixture: "SIMULATED provider, not actual audio",
        assertions: actions.length,
      }),
    );
    for (const view of views.splice(0)) await view[Symbol.asyncDispose]();
  }
} catch (error) {
  console.error(JSON.stringify({ scenario: activeScenario, result: "FAIL" }));
  console.error("Scenario failure:", error);
  for (const [index, view] of views.entries()) {
    const diagnostics = await Promise.allSettled([
      view
        .screenshot()
        .then((image) => Bun.write(`${evidence}/failure-${index}.png`, image)),
      view.evaluate(
        "JSON.stringify({text: document.body.innerText, qa: window.__hostQA})",
      ),
    ]);
    console.error(diagnostics);
  }
  throw error;
} finally {
  await Bun.write(`${evidence}/actions.json`, JSON.stringify(actions, null, 2));
  for (const view of views) await view[Symbol.asyncDispose]();
  await qa.close();
  await Bun.write(
    `${evidence}/cleanup.json`,
    JSON.stringify(
      {
        browsersClosed: true,
        serversStopped: true,
        directoryRemoved: !(await Bun.file(
          `${qa.directory}/qa.sqlite`,
        ).exists()),
        url: qa.url,
      },
      null,
      2,
    ),
  );
}
