export {};

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const TOKEN = process.env.ADMIN_TOKEN;

if (!TOKEN) throw new Error("ADMIN_TOKEN is required to run test-flow.ts");

type ApiBody = {
  ok?: boolean;
  error?: string;
};

type SearchHit = {
  trackId: number;
  trackName: string;
  artistName: string;
  albumUrl: string;
  trackNumber: number;
  durationSec?: number | null;
  artworkUrl?: string;
  [key: string]: unknown;
};

type QueueState = {
  queue: Array<{ id: string; deviceId: string | null; requestedBy: string }>;
};

type TableInfo = { id: number; label: string; url?: string };

const j = async (r: Response): Promise<{ status: number; body: ApiBody }> => ({
  status: r.status,
  body: (await r.json().catch(() => null)) as ApiBody,
});

// 기기 쿠키를 흉내: /api/table 응답의 Set-Cookie를 이후 요청에 재사용
let cookie = "";

async function guestFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
}

// 1. 테이블 생성 (어드민)
const created = await j(
  await fetch(`${BASE}/api/admin/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify({ label: `플로우테스트-${Date.now() % 10000}` }),
  }),
);
const table = (created.body as { table?: TableInfo }).table;
if (!created.body.ok || !table) throw new Error("table create failed");
const k = table.url ? (new URL(table.url).searchParams.get("k") ?? "") : "";
console.log("1. table create:", created.status, `#${table.id}`);

// 2. 손님 부트스트랩 (쿠키 발급)
const tableRes = await guestFetch(
  `/api/table?t=${table.id}&k=${encodeURIComponent(k)}`,
);
const setCookies = tableRes.headers.getSetCookie?.() ?? [];
for (const c of setCookies) {
  if (c.startsWith("bj_did=")) cookie = c.split(";")[0] ?? "";
}
const tableInfo = (await tableRes.json()) as TableInfo & { deviceId: string };
console.log(
  "2. guest bootstrap:",
  tableRes.status,
  tableInfo.label,
  "device issued:",
  cookie.length > 0,
);

// 3. 검색
const s = (await (
  await guestFetch("/api/search?q=daft+punk+get+lucky")
).json()) as { hits: SearchHit[] };
const hit = s.hits[0];
if (!hit) throw new Error("Search returned no Get Lucky result");
console.log("3. search hit:", hit.trackName, "—", hit.artistName);

// 4. 신청 #1 (성공)
let r = await j(
  await guestFetch("/api/request", {
    method: "POST",
    body: JSON.stringify({
      ...hit,
      tableId: table.id,
      tableSecret: k,
    }),
  }),
);
console.log("4. request #1:", r.status, r.body.ok ? "ok" : r.body.error);

// 5. 신청 #2 (같은 기기 → 409)
r = await j(
  await guestFetch("/api/request", {
    method: "POST",
    body: JSON.stringify({
      ...hit,
      tableId: table.id,
      tableSecret: k,
    }),
  }),
);
console.log(
  "5. request #2 (device limit):",
  r.status,
  r.status === 409 ? "409 ok" : "NOT 409 FAIL",
);

// 6. 본인 곡 취소
let st = (await (await guestFetch("/api/state")).json()) as QueueState;
const mine = st.queue.find((x) => x.requestedBy === tableInfo.label);
if (mine) {
  r = await j(
    await guestFetch("/api/cancel", {
      method: "POST",
      body: JSON.stringify({ id: mine.id }),
    }),
  );
  console.log("6. cancel own:", r.status, r.body.ok ? "ok" : "FAIL");
}

// 7. 어드민 무토큰 401
r = await j(await fetch(`${BASE}/api/admin/skip`, { method: "POST" }));
console.log(
  "7. admin no token:",
  r.status,
  r.status === 401 ? "401 ok" : "FAIL",
);

// 8. 어드민 추가 + 순서 뒤집기
const addBody = { ...hit, tableId: table.id, tableSecret: k };
r = await j(
  await fetch(`${BASE}/api/admin/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify(hit),
  }),
);
console.log("8. admin add:", r.status, r.body.ok ? "ok" : r.body.error);

st = (await (await fetch(`${BASE}/api/state`)).json()) as QueueState;
const ids = st.queue.map((x) => x.id);
if (ids.length >= 2) {
  const reversed = [...ids].reverse();
  r = await j(
    await fetch(`${BASE}/api/admin/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({ ids: reversed }),
    }),
  );
  st = (await (await fetch(`${BASE}/api/state`)).json()) as QueueState;
  console.log(
    "9. reorder:",
    r.status,
    JSON.stringify(st.queue.map((x) => x.id)) === JSON.stringify(reversed)
      ? "ok"
      : "FAIL",
  );
}

// 10. 신청 일시중지 토글
r = await j(
  await fetch(`${BASE}/api/admin/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify({ requestsPaused: true }),
  }),
);
r = await j(
  await guestFetch("/api/request", {
    method: "POST",
    body: JSON.stringify({ ...addBody }),
  }),
);
console.log(
  "10. request while paused:",
  r.status,
  r.status === 403 ? "403 ok" : "NOT 403 FAIL",
);
await j(
  await fetch(`${BASE}/api/admin/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify({ requestsPaused: false, notice: "" }),
  }),
);

// 11. 테이블 정리
r = await j(
  await fetch(`${BASE}/api/admin/tables/${table.id}`, {
    method: "DELETE",
    headers: { "x-admin-token": TOKEN },
  }),
);
console.log("11. table cleanup:", r.status, r.body.ok ? "ok" : "FAIL");

console.log("\n✅ test-flow done — 큐에 남은 곡은 어드민에서 확인/삭제하세요");
