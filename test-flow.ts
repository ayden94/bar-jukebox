export {};

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const TOKEN = process.env.ADMIN_TOKEN;

if (!TOKEN) throw new Error("ADMIN_TOKEN is required to run test-flow.ts");

type ApiBody = {
  ok?: boolean;
  error?: string;
};

type SearchHit = {
  trackName: string;
  artistName: string;
  albumUrl: string;
  trackNumber: number;
  [key: string]: unknown;
};

type QueueState = {
  queue: Array<{ id: string }>;
};

const j = async (r: Response): Promise<{ status: number; body: ApiBody }> => ({
  status: r.status,
  body: (await r.json().catch(() => null)) as ApiBody,
});

const s = (await (
  await fetch(`${BASE}/api/search?q=daft+punk+get+lucky`)
).json()) as { hits: SearchHit[] };
const hit = s.hits[0];
if (!hit) throw new Error("Search returned no Get Lucky result");
console.log("1. search hit:", hit.trackName, "—", hit.artistName);
console.log(
  "   albumUrl uses music scheme:",
  hit.albumUrl.startsWith("music://"),
);

let r = await j(
  await fetch(`${BASE}/api/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...hit, nickname: "민준" }),
  }),
);
console.log("2. request #1:", r.status, r.body.ok ? "ok" : r.body.error);

r = await j(
  await fetch(`${BASE}/api/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...hit, nickname: "민준" }),
  }),
);
console.log(
  "3. request #2 (cooldown):",
  r.status,
  r.body.error ? "blocked ok" : "NOT BLOCKED FAIL",
);

const hit2 = s.hits[1] ?? hit;
r = await j(
  await fetch(`${BASE}/api/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...hit2, nickname: "지훈" }),
  }),
);
console.log("4. request diff nick:", r.status, r.body.ok ? "ok" : r.body.error);

r = await j(await fetch(`${BASE}/api/admin/skip`, { method: "POST" }));
console.log(
  "5. admin no token:",
  r.status,
  r.status === 401 ? "401 ok" : "NOT 401 FAIL",
);

r = await j(
  await fetch(`${BASE}/api/admin/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
    body: JSON.stringify(hit),
  }),
);
console.log("6. admin add:", r.status, r.body.ok ? "ok" : r.body.error);

let st = (await (await fetch(`${BASE}/api/state`)).json()) as QueueState;
const ids = st.queue.map((x) => x.id);
console.log("7. state queue len:", st.queue.length, "ids:", ids.length);

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
  const newOrder = st.queue.map((x) => x.id);
  console.log(
    "8. reorder:",
    r.status,
    r.body.ok ? "ok" : "?",
    "reversed match:",
    JSON.stringify(newOrder) === JSON.stringify(reversed),
  );
}

if (st.queue.length) {
  const lastQueuedSong = st.queue.at(-1);
  if (!lastQueuedSong) throw new Error("Queue unexpectedly became empty");
  const removeId = lastQueuedSong.id;
  r = await j(
    await fetch(`${BASE}/api/admin/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({ id: removeId }),
    }),
  );
  st = (await (await fetch(`${BASE}/api/state`)).json()) as QueueState;
  console.log(
    "9. remove:",
    r.status,
    r.body.ok ? "ok" : "?",
    "queue len now:",
    st.queue.length,
  );
}

r = await j(
  await fetch(`${BASE}/api/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: "" }),
  }),
);
console.log("10. bad body:", r.status, r.body.error);

console.log("\n=== final state ===");
console.log(JSON.stringify(st, null, 2));
