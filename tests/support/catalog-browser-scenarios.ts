import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserCatalogRequest } from "../../src/domains/music/browser-catalog-protocol";
import { catalogFixtureTracks } from "./browser-catalog-fixture";
import { armCondition, expectCondition } from "./browser-lifecycle";
import { startCatalogQA } from "./catalog-qa";
import { hostProbe } from "./music-host-qa";

type Scenario = "browser-catalog" | "stale-catalog" | "catalog-capacity-fence";

export async function runCatalogScenarios(scenarios: readonly Scenario[]) {
  const evidence = resolve(".omo/evidence/boot-selected-music-playback/task-8");
  await mkdir(evidence, { recursive: true });
  const qa = await startCatalogQA();
  const views: Bun.WebView[] = [];
  const actions: unknown[] = [];
  const reports: unknown[] = [];
  const token = "qa-local-only";
  const screenshot = async (view: Bun.WebView, name: string) =>
    Bun.write(`${evidence}/${name}.png`, await view.screenshot());
  const save = async (name: string, value: unknown) =>
    Bun.write(`${evidence}/${name}.json`, JSON.stringify(value, null, 2));
  const phase = (value: string) =>
    `document.querySelector("[data-browser-phase]")?.dataset.browserPhase === ${JSON.stringify(value)}`;

  async function open(path: string, width = 1280, height = 900) {
    const view = new Bun.WebView({
      backend: { type: "chrome", url: false },
      width,
      height,
    });
    views.push(view);
    await view.navigate("about:blank");
    await view.cdp("Page.addScriptToEvaluateOnNewDocument", {
      source: hostProbe,
    });
    await view.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width === 390,
    });
    await view.navigate(`${qa.url}${path}`);
    return view;
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
    actions.push({ selector, assertion: label, result: "PASS" });
  }

  async function connect(view: Bun.WebView) {
    await click(
      view,
      "#browser-music-connect",
      phase("connected"),
      "실제 호스트 factory 등록과 인증·연결 후 owner를 얻어요",
    );
    const state = await qa.api("/api/admin/playback/snapshot");
    assert.equal(state.body.ownerConnected, true);
    return state.body;
  }

  async function disconnect(view: Bun.WebView) {
    const unsubscribed = qa.control("unsubscribed");
    await click(
      view,
      "#browser-music-disconnect",
      phase("disconnected"),
      "실제 정지·해제 뒤 catalog와 SSE를 정리해요",
    );
    assert.equal(await unsubscribed, 0);
    assert.equal((await qa.state()).subscriptions, 0);
  }

  async function ensurePlaying(view: Bun.WebView) {
    const state = await qa.api("/api/state");
    if (state.body.nowPlaying) return;
    await armCondition(
      view,
      "window.__hostQA.publicState?.nowPlaying?.status === 'playing'",
    );
    const added = await qa.api("/api/admin/add", catalogFixtureTracks[0]!.ref);
    assert.equal(added.status, 201);
    await expectCondition(
      view,
      "fixture도 receipt 아닌 playing 관측 이후 재생 상태가 돼요",
    );
  }

  async function post(
    request: BrowserCatalogRequest,
    overrides: object = {},
    result: unknown = {
      ok: true,
      value: { tracks: [], nextCursor: null },
    },
  ) {
    return qa.api("/api/admin/music/catalog-result", {
      requestId: request.requestId,
      ownerEpoch: request.ownerEpoch,
      executorSessionId: request.executorSessionId,
      target: request.target,
      connectionGeneration: request.connectionGeneration,
      ...overrides,
      result,
    });
  }

  try {
    await save("resources", {
      url: qa.url,
      pid: qa.pid,
      directory: qa.directory,
      provider:
        "QA fixture only; NOT actual YouTube Music account metadata or audio",
      scenarios,
    });
    const admin = await open("/admin/music");
    await armCondition(admin, "!!document.querySelector('#admin-password')");
    await expectCondition(admin, "production 관리자 로그인 문서");
    await admin.click("#admin-password");
    await admin.type(token);
    await click(
      admin,
      "button[type=submit]",
      "!!document.querySelector('#browser-music-connect')",
      "실제 관리자 인증 폼",
    );
    const initial = await qa.api("/api/admin/music");
    assert.equal(
      initial.body.runtime?.readiness ?? initial.body.readiness,
      "auth-required",
    );
    const noOwnerSearch = await qa.api("/api/search?q=fixture");
    assert.equal(noOwnerSearch.status, 500);
    await connect(admin);
    await screenshot(admin, "admin-desktop");
    await admin.cdp("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await screenshot(admin, "admin-mobile");
    await admin.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    for (const scenario of scenarios) {
      if (!(await qa.api("/api/admin/playback/snapshot")).body.ownerConnected)
        await connect(admin);
      if (scenario === "browser-catalog") {
        const table = await qa.api("/api/admin/tables", {
          label: "카탈로그 검증",
        });
        assert.equal(table.status, 201);
        const tableUrl = new URL(table.body.table.url);
        const guest = await open(`/${tableUrl.search}`, 390, 844);
        await armCondition(
          guest,
          "!!document.querySelector('#q') && !!window.__hostQA.publicState",
        );
        await expectCondition(guest, "production 모바일 게스트 검색");
        await guest.click("#q");
        await guest.type("카탈로그");
        await armCondition(
          guest,
          "document.querySelectorAll('.guest > ul > li').length === 3 && document.querySelector('.guest > ul')?.textContent.includes('카탈로그 검증 곡 3')",
        );
        await guest.evaluate(
          "document.querySelector('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))",
        );
        await expectCondition(
          guest,
          "서버 relay와 실제 browser CatalogPort를 통해 다음 페이지까지 표시해요",
        );
        const calls = await admin.evaluate("window.__catalogFixture.calls");
        assert.deepEqual(calls, [
          { type: "search", query: "카탈로그", cursor: null },
          {
            type: "search",
            query: "카탈로그",
            cursor: "fixture/opaque+cursor",
          },
        ]);
        const artwork = await guest.evaluate<string[]>(
          "Array.from(document.querySelectorAll('.guest > ul img'), image => image.getAttribute('src'))",
        );
        assert.equal(artwork.length, 3);
        assert(
          artwork.every((source) =>
            source.startsWith("/api/artwork?providerId=youtube-music&"),
          ),
        );
        const selected = catalogFixtureTracks[1]!;
        await click(
          guest,
          ".guest > ul > li:nth-child(2) button",
          `window.__hostQA.publicState?.nowPlaying?.song?.ref?.trackId === ${JSON.stringify(selected.ref.trackId)} && window.__hostQA.publicState.nowPlaying.status === "playing"`,
          "선택한 ref를 fresh lookup한 뒤 실제 신청과 관측 playing에 반영해요",
        );
        assert.deepEqual(
          await admin.evaluate("window.__catalogFixture.calls.at(-1)"),
          {
            type: "lookup",
            ref: selected.ref,
          },
        );
        const state = await qa.api("/api/state");
        assert.deepEqual(state.body.nowPlaying.song.ref, selected.ref);
        assert.equal(state.body.nowPlaying.song.title, selected.title);
        assert(!JSON.stringify(state.body).includes("catalogRequests"));
        const unauthenticated = await fetch(
          `${qa.url}/api/admin/music/catalog-result`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        );
        assert.equal(unauthenticated.status, 401);
        await screenshot(guest, "guest");
        await guest.cdp("Emulation.setDeviceMetricsOverride", {
          width: 1280,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await screenshot(guest, "guest-desktop");
        assert.deepEqual(await guest.evaluate("window.__hostQA.failures"), []);
        const report = {
          scenario,
          result: "PASS",
          initial,
          noOwnerSearch,
          calls,
          artwork,
          selected: state.body.nowPlaying.song,
          fixtureOnly: true,
        };
        await save("catalog", report);
        reports.push(report);
      } else if (scenario === "stale-catalog") {
        const search = await qa.api("/api/search?q=cursor-fixture");
        assert.equal(search.status, 200);
        assert(search.body.nextCursor);
        assert.notEqual(search.body.nextCursor, "fixture/opaque+cursor");
        const wrongQuery = await qa.api(
          `/api/search?q=wrong&cursor=${search.body.nextCursor}`,
        );
        assert.equal(wrongQuery.status, 500);
        await qa.control("advance-clock");
        const expired = await qa.api(
          `/api/search?q=cursor-fixture&cursor=${search.body.nextCursor}`,
        );
        assert.equal(expired.status, 500);
        await admin.evaluate("window.__catalogFixture.wrongRef = true");
        await qa.control("lookup");
        const lookup = (await qa.state()).requests.find(
          (request) => request.operation.type === "lookup",
        );
        assert(lookup);
        const wrongRef = await post(
          lookup,
          {},
          { ok: true, value: catalogFixtureTracks[2] },
        );
        assert.equal(wrongRef.status, 409);
        assert(
          (await qa.state()).requests.some(
            (request) => request.requestId === lookup.requestId,
          ),
        );
        await qa.control("abort-all");
        await admin.evaluate("window.__catalogFixture.wrongRef = false");
        const badArtwork = await fetch(
          `${qa.url}/api/artwork?providerId=youtube-music&artworkId=${encodeURIComponent("https://evil.invalid/cover")}`,
        );
        assert.equal(badArtwork.status, 404);
        const redirect = await fetch(
          `${qa.url}/api/artwork?providerId=youtube-music&artworkId=${encodeURIComponent("https://i.ytimg.com/redirect")}`,
        );
        assert.equal(redirect.status, 404);
        assert(
          !(await qa.state()).artworkRequests.some(
            (url) => url.includes("evil") || url.includes("untrusted"),
          ),
        );
        await armCondition(admin, "window.__catalogFixture.running === 1");
        await qa.control("start");
        await expectCondition(
          admin,
          "이전 owner의 catalog 작업이 실제 브라우저에서 실행돼요",
        );
        const old = (await qa.state()).requests[0]!;
        await disconnect(admin);
        const late = await post(old);
        assert.equal(late.status, 409);
        await screenshot(admin, "failure");
        await connect(admin);
        assert.equal((await post(old)).status, 409);
        assert.equal(
          (
            await qa.api(
              `/api/search?q=cursor-fixture&cursor=${search.body.nextCursor}`,
            )
          ).status,
          500,
        );
        const report = {
          scenario,
          result: "PASS",
          wrongQuery: wrongQuery.status,
          expired: expired.status,
          wrongRef: wrongRef.status,
          artwork: [badArtwork.status, redirect.status],
          late: late.status,
          fixtureOnly: true,
          clock:
            "injected QA clock advanced 300000ms; browser clocks not assumed aligned",
        };
        await save("stale-catalog", report);
        reports.push(report);
      } else {
        await ensurePlaying(admin);
        const notifications = (await qa.state()).notifications;
        await armCondition(admin, "window.__catalogFixture.running === 4");
        const keys = (await qa.control("start", { count: 32 })) as string[];
        await expectCondition(
          admin,
          "SSE가 32개 대기를 전달하지만 브라우저는 4개만 실행해요",
        );
        const full = await qa.state();
        assert.equal(full.requests.length, 32);
        assert(full.notifications > notifications);
        assert.equal(
          await admin.evaluate("window.__catalogFixture.maxRunning"),
          4,
        );
        const overflow = (await qa.control("start")) as string[];
        const overflowState = await qa.state();
        assert.deepEqual(overflowState.results[overflow[0]!], {
          ok: false,
          error: { code: "rate-limited" },
        });
        const beforeAbort = full.requests[0]!;
        const aborted = await admin.evaluate<number>(
          "window.__catalogFixture.aborted",
        );
        await armCondition(
          admin,
          `window.__catalogFixture.aborted > ${aborted} && window.__catalogFixture.running === 4`,
        );
        await qa.control("abort", { key: keys[0] });
        await expectCondition(
          admin,
          "abort snapshot은 실행 작업을 취소하고 다음 슬롯을 즉시 열어요",
        );
        assert.equal((await qa.state()).requests.length, 31);
        assert.equal((await post(beforeAbort)).status, 409);
        await qa.control("start");
        assert.equal((await qa.state()).requests.length, 32);
        const current = (await qa.state()).requests[0]!;
        const mismatch = [
          { requestId: "not-pending" },
          { ownerEpoch: current.ownerEpoch + 1 },
          { executorSessionId: "stale-session" },
          { connectionGeneration: "stale-generation" },
          ...["providerId", "modeId", "targetId"].map((field) => ({
            target: { ...current.target, [field]: "stale-target" },
          })),
        ];
        const rejected = await Promise.all(
          mismatch.map((change) => post(current, change)),
        );
        assert(rejected.every((reply) => reply.status === 409));
        assert.equal((await qa.state()).requests.length, 32);
        assert.equal((await post(current)).status, 201);
        assert.equal((await post(current)).status, 409);
        const pendingBeforeStop = (await qa.state()).requests.length;
        const stopped = await qa.api("/api/admin/skip", {});
        assert.equal(stopped.status, 201);
        assert.equal((await qa.api("/api/state")).body.nowPlaying, null);
        assert(pendingBeforeStop > 0);
        assert((await qa.state()).requests.length > 0);
        assert.equal(
          await admin.evaluate("window.__catalogFixture.running"),
          4,
        );
        assert(
          (
            await admin.evaluate<string[]>("window.__catalogFixture.commands")
          ).includes("stop"),
        );
        await screenshot(admin, "capacity-fence");
        await armCondition(admin, "window.__catalogFixture.running === 0");
        await qa.control("abort-all");
        await expectCondition(admin, "남은 작업은 release 없이 취소돼요");
        const beforeDisconnect = await qa.state();
        await disconnect(admin);
        const afterDisconnect = await qa.state();
        assert.equal(afterDisconnect.requests.length, 0);
        assert.equal(afterDisconnect.subscriptions, 0);
        const report = {
          scenario,
          result: "PASS",
          runningLimit: 4,
          totalLimit: 32,
          overflow: overflowState.results[overflow[0]!],
          mismatches: rejected.map((reply) => reply.status),
          duplicate: 409,
          postAbort: 409,
          pendingBeforeStop,
          stopStatus: stopped.status,
          heldPromisesReleased: false,
          beforeDisconnect,
          afterDisconnect,
          fixtureOnly: true,
        };
        await save("capacity-fence", report);
        reports.push(report);
      }
      console.info(
        JSON.stringify({ scenario, result: "PASS", fixtureOnly: true }),
      );
    }
    if ((await qa.api("/api/admin/playback/snapshot")).body.ownerConnected)
      await disconnect(admin);
    assert.deepEqual(await admin.evaluate("window.__hostQA.failures"), []);
    await save("actions", actions);
    await save("results", reports);
  } catch (error) {
    await save("failure-detail", { error: String(error), actions, reports });
    for (let index = 0; index < views.length; index++)
      await screenshot(views[index]!, `failed-view-${index}`).catch(
        () => undefined,
      );
    throw error;
  } finally {
    for (const view of views) await view.close();
    await qa.close();
    await save("cleanup", {
      fixtureOnly: true,
      browserViewsClosed: views.length,
      serverStopped: true,
      serverPid: qa.pid,
      temporaryDirectoryRemoved: qa.directory,
    });
  }
}
