import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { z } from "zod";
import { startPlaybackLoop, stopPlayback } from "./playback";
import { searchMusic } from "./search";
import { state } from "./state";
import type { Song } from "./types";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PORT = Number(process.env.PORT ?? 5173);

const app = new Hono();

const SongInput = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  artworkUrl: z.string(),
  albumUrl: z.string(),
  trackNumber: z.number(),
});

const RequestBody = SongInput.extend({
  nickname: z
    .string()
    .trim()
    .min(1, "닉네임을 입력해주세요")
    .max(20, "닉네임은 20자 이내"),
});

function patronKeyOf(nickname: string): string {
  return nickname.trim().toLowerCase();
}

function makeSong(
  input: z.infer<typeof SongInput>,
  requestedBy: string,
  patronKey: string | null,
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
    requestedBy,
    patronKey,
    requestedAt: Date.now(),
    isStaff,
  };
}

app.get("/api/state", (c) => c.json(state.snapshot()));

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
  const { nickname, ...songInput } = parsed.data;
  const patronKey = patronKeyOf(nickname);

  if (state.patronHasActive(patronKey)) {
    return c.json(
      {
        error:
          "네가 신청한 곡이 아직 큐에 있어요. 그 곡이 재생된 뒤에 또 신청할 수 있어요.",
      },
      409,
    );
  }

  const song = makeSong(songInput, nickname, patronKey, false);
  state.enqueue(song);
  console.log(
    `+ request: ${song.trackName} \u2014 ${song.artistName} (by ${nickname})`,
  );
  return c.json({ ok: true, song });
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
  const song = makeSong(parsed.data, "\ubc14\ud150\ub354", null, true);
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
  fetch: app.fetch,
};
