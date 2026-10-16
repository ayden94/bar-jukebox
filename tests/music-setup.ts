import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { startServerProcess } from "./support/server-process";

const token = randomBytes(32).toString("hex");
// 실제 production 진입점의 잘못된 설정은 Music.app을 시작하지 않아야 해요.
const server = await startServerProcess({
  command: [process.execPath, resolve("dist/server/main.js")],
  env: {
    ...process.env,
    PORT: "0",
    DATABASE_URL: ":memory:",
    ADMIN_TOKEN: token,
    DEVICE_COOKIE_SECRET: token,
    MUSIC_PROVIDER: "unregistered-provider",
    MUSIC_PLAYBACK_MODE: "missing-mode",
    PLAYBACK_DISABLED: "1",
  },
});
const headers = { "Content-Type": "application/json", "x-admin-token": token };
try {
  const unauthorized = await fetch(`${server.url}/api/admin/music`);
  assert.equal(unauthorized.status, 401);
  const response = await fetch(`${server.url}/api/admin/music`, { headers });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.readiness, "setup-required");
  assert.deepEqual(state.active, {
    providerId: "unregistered-provider",
    modeId: "missing-mode",
  });
  assert.deepEqual(state.locks, { providerId: true, modeId: true });
  assert.equal(state.connectedTarget, null);
  assert.equal(state.owner, null);
  assert(Object.values(state.actions).every((allowed) => allowed === false));
  const page = await fetch(`${server.url}/admin/music`);
  assert.equal(page.status, 200);
  assert((await page.text()).includes("admin-music"));
  const changed = await fetch(`${server.url}/api/admin/music/config`, {
    method: "POST",
    headers,
    body: JSON.stringify({ providerId: "apple-music", modeId: "applescript" }),
  });
  assert.equal(changed.status, 409);
  const search = await fetch(`${server.url}/api/search?q=fixture`);
  assert.equal(search.status, 500);
  const add = await fetch(`${server.url}/api/admin/add`, {
    method: "POST",
    headers,
    body: JSON.stringify({ providerId: "apple-music", trackId: "101" }),
  });
  assert.equal(add.status, 503);
  const publicState = await (await fetch(`${server.url}/api/state`)).json();
  assert.deepEqual(publicState.queue, []);
  assert.equal(publicState.nowPlaying, null);
  console.info(
    "음악 설정: 실제 production 부팅·관리자 SSR·env 잠금·미설정 검색/신청 차단 검증 통과",
  );
} catch (error) {
  console.error(server.output);
  throw error;
} finally {
  await server.stop();
}
