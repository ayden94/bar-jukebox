import assert from "node:assert/strict";
import { armCondition, expectCondition } from "./browser-lifecycle";
import type { startMusicHostQA } from "./music-host-qa";

export async function verifyMusicKitControls(
  view: Bun.WebView,
  qa: Awaited<ReturnType<typeof startMusicHostQA>>,
) {
  await view.evaluate("window.__musickitQA.automatic = true");
  const before = (await qa.api("/api/admin/playback/snapshot")).body.attempt;
  for (const [action, state] of [
    ["pause", "paused"],
    ["resume", "playing"],
    ["previous", "playing"],
  ]) {
    const condition = `window.__hostQA.requests.filter(r => r.path.endsWith("/observation") && r.body.observation.state === ${JSON.stringify(state)}).length`;
    const count = await view.evaluate<number>(condition);
    await armCondition(view, `${condition} > ${count}`);
    assert.equal((await qa.api(`/api/admin/${action}`, {})).status, 201);
    await expectCondition(view, `${action} SDK 관측이 실제 서버에 도착해요`);
    assert.equal(
      (await qa.api("/api/admin/playback/snapshot")).body.attempt.state,
      state,
    );
  }
  const after = (await qa.api("/api/admin/playback/snapshot")).body.attempt;
  assert.notEqual(after.attemptId, before.attemptId);
  assert.notDeepEqual(after.binding, before.binding);
  assert.equal(after.binding.payload.trackId, "101");
  assert.equal(
    (
      await qa.api("/api/admin/add", {
        providerId: "apple-music",
        trackId: "102",
      })
    ).status,
    201,
  );
  await armCondition(
    view,
    'window.__hostQA.requests.some(r => r.path.endsWith("/observation") && r.body.observation.state === "playing" && r.body.observation.trackRef?.trackId === "102")',
  );
  await view.evaluate("window.__musickitQA.state(5)");
  await expectCondition(
    view,
    "현재 occurrence 자연 종료 후 다음 신청곡만 재생해요",
  );
  const state = (await qa.api("/api/state")).body;
  assert.equal(state.nowPlaying.song.ref.trackId, "102");
  assert.equal(
    state.history.filter(
      (song: { ref: { trackId: string } }) => song.ref.trackId === "101",
    ).length,
    1,
  );
}
