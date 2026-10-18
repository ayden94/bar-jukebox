import { strict as assert } from "node:assert";
import type { TrackMetadata } from "../src/pages/types";
import {
  armCondition,
  expectCondition,
  lifecycleProbe,
} from "./support/browser-lifecycle";
import { createIsolatedServer } from "./support/isolated-server";

const supported = [
  "public-contract",
  "browser-catalog",
  "stale-catalog",
  "catalog-capacity-fence",
] as const;
const args = process.argv.slice(2);
if (
  args.length !== 0 &&
  (args.length !== 2 ||
    args[0] !== "--scenario" ||
    !supported.some((scenario) => scenario === args[1]))
)
  throw new Error(`알 수 없는 scenario: ${args.join(" ")}`);
const scenarios = args.length
  ? supported.filter((scenario) => scenario === args[1])
  : supported;
const catalogScenarios = scenarios.filter(
  (scenario) => scenario !== "public-contract",
);
if (catalogScenarios.length) {
  const { runCatalogScenarios } = await import(
    "./support/catalog-browser-scenarios"
  );
  await runCatalogScenarios(catalogScenarios);
}
if (!scenarios.includes("public-contract")) process.exit(0);

const cursor = "opaque/+?cursor=한글&next";
const hits: TrackMetadata[] = ["one", "two", "three"].map((providerId) => ({
  ref: { providerId, trackId: "shared/id?&" },
  title: `fixture-${providerId}`,
  artist: "fixture-artist",
  durationSec: 180,
  artwork:
    providerId === "three"
      ? null
      : {
          providerId,
          artworkId: "opaque/art?size=1&name=한글",
        },
  sourceUrl: null,
}));
const searches: URL[] = [];
const submissions: { path: string; body: unknown }[] = [];
let releaseSubmission = Promise.withResolvers<void>();
await using server = await createIsolatedServer({
  async intercept(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/search") {
      searches.push(url);
      assert.equal(url.searchParams.get("q"), "fixture");
      if (url.searchParams.has("cursor")) {
        assert.equal(url.searchParams.get("cursor"), cursor);
        return Response.json({ hits: [hits[1], hits[2]], nextCursor: null });
      }
      return Response.json({ hits: hits.slice(0, 2), nextCursor: cursor });
    }
    if (url.pathname === "/api/artwork") {
      assert.equal(
        url.searchParams.get("artworkId"),
        hits[0]!.artwork!.artworkId,
      );
      assert(["one", "two"].includes(url.searchParams.get("providerId") ?? ""));
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#456"/></svg>',
        { headers: { "Content-Type": "image/svg+xml" } },
      );
    }
    if (url.pathname === "/api/admin/add" || url.pathname === "/api/request") {
      submissions.push({ path: url.pathname, body: await request.json() });
      await releaseSubmission.promise;
      return Response.json({ ok: true });
    }
  },
});
await using browser = new Bun.WebView({
  backend: { type: "chrome", url: false },
  width: 1440,
  height: 900,
});
await browser.navigate(`${server.url}/admin/songs`);
await browser.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: lifecycleProbe,
});
await browser.evaluate(
  `localStorage.setItem("bj_admin", ${JSON.stringify(server.token)})`,
);
await browser.navigate(`${server.url}/admin/songs`);
await armCondition(browser, "!!document.querySelector('#admin-search')");
await expectCondition(browser, "관리자 검색 준비");

async function search(inputSelector: string, listSelector: string) {
  await browser.scrollTo(inputSelector, { block: "center" });
  await browser.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(inputSelector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "fixture");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await armCondition(
    browser,
    `document.querySelectorAll(${JSON.stringify(`${listSelector} > li`)}).length === 3
      && document.querySelector(${JSON.stringify(listSelector)}).textContent.includes("fixture-three")`,
  );
  await browser.evaluate(
    inputSelector === "#admin-search"
      ? "document.querySelector('#admin-search').closest('form').requestSubmit()"
      : "document.querySelector('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))",
  );
  await expectCondition(browser, "커서 다음 페이지와 제공자별 트랙을 합쳐요");
  assert.deepEqual(
    await browser.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${listSelector} > li`)}), row => ({
      title: row.querySelector('img + div > div').textContent,
      artwork: row.querySelector('img').getAttribute('src'),
    }))`),
    hits.map((hit) => ({
      title: hit.title,
      artwork: hit.artwork
        ? `/api/artwork?providerId=${encodeURIComponent(hit.artwork.providerId)}&artworkId=${encodeURIComponent(hit.artwork.artworkId)}`
        : null,
    })),
  );
  const selected = `${listSelector} > li:nth-child(2) button`;
  await armCondition(
    browser,
    `document.querySelector(${JSON.stringify(selected)}).disabled`,
  );
  await browser.click(selected);
  await expectCondition(browser, "요청 중 중복 제출을 막아요");
  await armCondition(
    browser,
    `!document.querySelector(${JSON.stringify(selected)}).disabled`,
  );
  releaseSubmission.resolve();
  await expectCondition(browser, "요청을 마치면 조작을 복원해요");
  releaseSubmission = Promise.withResolvers<void>();
}

await search("#admin-search", 'section[aria-labelledby="add-heading"] ul');
assert.deepEqual(submissions, [
  {
    path: "/api/admin/add",
    body: hits[1]!.ref,
  },
]);
assert.equal(searches.length, 2);

const response = await fetch(`${server.url}/api/admin/tables`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-token": server.token,
  },
  body: JSON.stringify({ label: "계약 검증" }),
});
assert.equal(response.status, 201);
const created: { table: { url: string } } = await response.json();
const tableUrl = new URL(created.table.url);
await browser.navigate(`${server.url}/${tableUrl.search}`);
await armCondition(
  browser,
  "!!document.querySelector('#q') && window.__lifecycle.states > 0",
);
await expectCondition(browser, "게스트 검색 준비");
await search("#q", ".guest > ul");
assert.deepEqual(submissions[1], {
  path: "/api/request",
  body: {
    ...hits[1]!.ref,
    tableId: Number(tableUrl.searchParams.get("t")),
    tableSecret: tableUrl.searchParams.get("k"),
  },
});
assert.equal(searches.length, 4);
assert.deepEqual(await browser.evaluate("window.__lifecycle.failures"), []);
console.info(
  "제공자별 트랙·커서 검색·커버 프록시·관리자/게스트 요청 계약 검증 통과",
);
console.info(JSON.stringify({ scenario: "public-contract", result: "PASS" }));
