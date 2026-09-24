import { networkInterfaces } from "node:os";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import QRCode from "qrcode";
import { z } from "zod";
import { onChange } from "./jukebox/bus";
import * as db from "./jukebox/db";
import { startPlaybackLoop, stopPlayback } from "./jukebox/playback";
import { searchMusic } from "./jukebox/search";
import { state } from "./jukebox/state";
import type { Song } from "./jukebox/types";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PORT = Number(process.env.PORT ?? 5173);

function detectLanIp(): string {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (String(net.family) === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

const BASE_URL = process.env.BASE_URL ?? `http://${detectLanIp()}:${PORT}`;

state.hydrate(db.loadState());

type SseClient = {
  writeSSE: (message: { event: string; data: string }) => Promise<void>;
};

const sseClients = new Set<SseClient>();

// state 변경(mutate)은 SQLite 저장 + SSE 브로드캐스트, 재생 위치(progress)는 브로드캐스트만.
onChange((event) => {
  const snapshot = state.snapshot();
  if (event === "mutate") db.saveSnapshot(snapshot);
  const data = JSON.stringify(snapshot);
  for (const client of [...sseClients]) {
    client.writeSSE({ event: "state", data }).catch(() => {
      sseClients.delete(client);
    });
  }
});

const app = new Hono<{ Variables: { deviceId: string } }>();

const SongInput = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  artworkUrl: z.string(),
  albumUrl: z.string(),
  trackNumber: z.number(),
  durationSec: z.number().nullable().optional(),
});

const RequestBody = SongInput.extend({
  tableId: z.number().int(),
  tableSecret: z.string().min(1),
});

function makeSong(
  input: z.infer<typeof SongInput>,
  requestedBy: string,
  deviceId: string | null,
  isStaff: boolean,
): Song {
  return {
    id: crypto.randomUUID(),
    trackId: input.trackId,
    trackName: input.trackName,
    artistName: input.artistName,
    artworkUrl: input.artworkUrl,
    albumUrl: input.albumUrl,
    trackNumber: input.trackNumber,
    durationSec: input.durationSec ?? null,
    requestedBy,
    deviceId,
    isStaff,
    requestedAt: Date.now(),
  };
}

// 모든 /api/* 요청에 기기 식별자 쿠키를 보장한다. 손님 신원은 닉네임이 아니라 이 기기 id.
app.use("/api/*", async (c, next) => {
  const existing = getCookie(c, "bj_did");
  const deviceId = existing ?? crypto.randomUUID();
  if (!existing) {
    setCookie(c, "bj_did", deviceId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "Lax",
      httpOnly: true,
    });
  }
  c.set("deviceId", deviceId);
  await next();
});

app.get("/api/state", (c) => c.json(state.snapshot()));

app.get("/api/table", (c) => {
  const tableId = Number(c.req.query("t"));
  const secret = c.req.query("k") ?? "";
  const table = Number.isInteger(tableId) ? db.getTable(tableId) : null;
  if (!table || table.secret !== secret) {
    return c.json({ error: "QR 코드를 확인할 수 없어요" }, 404);
  }
  return c.json({
    tableId: table.id,
    label: table.label,
    requestsPaused: state.isRequestsPaused(),
    notice: state.getNotice(),
    deviceId: c.get("deviceId"),
  });
});

app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ error: "검색어를 입력해주세요" }, 400);
  try {
    const hits = await searchMusic(q);
    return c.json({ hits });
  } catch (e) {
    console.error("search error:", e);
    return c.json({ error: "검색 중 오류가 발생했어요" }, 502);
  }
});

app.post("/api/request", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청이에요" },
      400,
    );
  }
  const { tableId, tableSecret, ...songInput } = parsed.data;
  const table = db.getTable(tableId);
  if (!table || table.secret !== tableSecret) {
    return c.json({ error: "유효하지 않은 테이블이에요" }, 403);
  }
  if (state.isRequestsPaused()) {
    return c.json({ error: "지금은 곡 신청을 받고 있지 않아요" }, 403);
  }
  const deviceId = c.get("deviceId");
  if (state.deviceHasActive(deviceId)) {
    return c.json(
      {
        error:
          "이 기기에서 신청한 곡이 아직 대기 중이에요. 그 곡이 재생된 뒤에 또 신청할 수 있어요.",
      },
      409,
    );
  }
  if (state.trackIsActive(songInput.trackId)) {
    return c.json({ error: "그 곡은 이미 대기열에 있어요" }, 409);
  }

  const song = makeSong(songInput, table.label, deviceId, false);
  state.enqueue(song);
  console.log(
    `+ request: ${song.trackName} \u2014 ${song.artistName} (${song.requestedBy})`,
  );
  return c.json({ ok: true, song });
});

app.post("/api/cancel", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { id?: string };
  if (!body?.id) return c.json({ error: "id가 필요해요" }, 400);
  const removed = state.removeOwnedFromQueue(body.id, c.get("deviceId"));
  return c.json({ ok: removed });
});

app.use("/api/admin/*", async (c, next) => {
  const token = c.req.header("x-admin-token");
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN)
    return c.json({ error: "관리자 인증이 필요해요" }, 401);
  return next();
});

app.post("/api/admin/skip", async (c) => {
  const current = state.nowPlayingSong();
  await stopPlayback().catch((e) => console.error("stop error:", e));
  if (current) state.finishNowPlaying("failed");
  return c.json({ ok: true });
});

app.post("/api/admin/remove", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { id?: string };
  if (!body?.id) return c.json({ error: "id가 필요해요" }, 400);
  const removed = state.removeFromQueue(body.id);
  return c.json({ ok: removed });
});

app.post("/api/admin/add", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SongInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "잘못된 곡 정보예요" }, 400);
  const song = makeSong(parsed.data, "바텐더", null, true);
  state.enqueue(song);
  console.log(`+ staff add: ${song.trackName} \u2014 ${song.artistName}`);
  return c.json({ ok: true, song });
});

app.post("/api/admin/reorder", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { ids?: string[] };
  if (!Array.isArray(body?.ids))
    return c.json({ error: "ids 배열이 필요해요" }, 400);
  state.reorder(body.ids);
  return c.json({ ok: true });
});

app.get("/api/admin/tables", (c) => {
  const tables = db.listTables().map((t) => ({
    id: t.id,
    label: t.label,
    url: `${BASE_URL}/?t=${t.id}&k=${t.secret}`,
    createdAt: t.createdAt,
  }));
  return c.json({ tables, baseUrl: BASE_URL });
});

app.post("/api/admin/tables", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      label: z
        .string()
        .trim()
        .min(1, "테이블 이름을 입력해주세요")
        .max(30, "테이블 이름은 30자 이내"),
    })
    .safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청이에요" },
      400,
    );
  }
  const secret = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const table = db.createTable(parsed.data.label, secret);
  console.log(`+ table: ${table.label} (#${table.id})`);
  return c.json({
    ok: true,
    table: {
      ...table,
      url: `${BASE_URL}/?t=${table.id}&k=${table.secret}`,
    },
  });
});

app.delete("/api/admin/tables/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "잘못된 id예요" }, 400);
  const removed = db.deleteTable(id);
  return c.json({ ok: removed });
});

app.get("/api/admin/tables/:id/qr", async (c) => {
  const id = Number(c.req.param("id"));
  const table = Number.isInteger(id) ? db.getTable(id) : null;
  if (!table) return c.json({ error: "테이블을 찾을 수 없어요" }, 404);
  const url = `${BASE_URL}/?t=${table.id}&k=${table.secret}`;
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 240,
  });
  return c.json({ url, svg });
});

app.post("/api/admin/settings", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      requestsPaused: z.boolean().optional(),
      notice: z.string().max(200, "공지는 200자 이내").optional(),
    })
    .safeParse(body);
  if (!parsed.success) return c.json({ error: "잘못된 요청이에요" }, 400);
  if (parsed.data.requestsPaused !== undefined) {
    state.setRequestsPaused(parsed.data.requestsPaused);
  }
  if (parsed.data.notice !== undefined) {
    state.setNotice(parsed.data.notice);
  }
  return c.json({ ok: true });
});

app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    sseClients.add(stream);
    stream.onAbort(() => {
      sseClients.delete(stream);
    });
    try {
      await stream.writeSSE({
        event: "state",
        data: JSON.stringify(state.snapshot()),
      });
      while (true) {
        await stream.sleep(25000);
        await stream.writeSSE({ event: "ping", data: "" });
      }
    } catch {
      sseClients.delete(stream);
    }
  }),
);

const html = (path: string) =>
  new Response(Bun.file(path), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
app.get("/", () => html("./public/index.html"));
app.get("/admin", () => html("./public/admin.html"));

app.use("/*", serveStatic({ root: "./public" }));

startPlaybackLoop().catch((e) => console.error("playback loop crashed:", e));

export default {
  port: PORT,
  idleTimeout: 255,
  fetch: app.fetch,
};
