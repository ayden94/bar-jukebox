import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NowPlayingCard } from "./admin/now-playing-card";
import type { RecoveryState } from "./admin/use-recovery-fence";
import { NowPlayingArea } from "./guest/now-playing";
import type { NowPlayingView } from "./types";

const song: NowPlayingView["song"] = {
  formatVersion: 1,
  id: "request-1",
  ref: { providerId: "fixture", trackId: "track-1" },
  title: "fixture-title",
  artist: "fixture-artist",
  durationSec: 180,
  artwork: null,
  sourceUrl: null,
  requestedBy: "fixture-table",
  isMine: true,
};

for (const status of [
  "starting",
  "playing",
  "paused",
  "waiting",
  "reconciliation-required",
] satisfies NowPlayingView["status"][]) {
  test(`재생 제어: ${status} 상태의 조작 가능 여부와 복구 확인을 구분해요`, async () => {
    const np: NowPlayingView = {
      song,
      status,
      positionSec: 0,
      durationSec: 180,
    };
    const disabled: boolean[] = [];
    const html = renderToStaticMarkup(
      <NowPlayingCard
        np={np}
        onPrevious={async () => {}}
        onTogglePlayback={async () => {}}
        onSkip={async () => {}}
        onConfirmStopped={async () => {}}
      />,
    );

    await new HTMLRewriter()
      .on("button", {
        element(element) {
          disabled.push(element.hasAttribute("disabled"));
        },
      })
      .transform(new Response(html))
      .text();

    const uncertain = status !== "playing" && status !== "paused";
    const recovery =
      status === "waiting" || status === "reconciliation-required";
    expect(disabled).toEqual(
      recovery ? [true, true, true, true, true] : [uncertain, uncertain, false],
    );
  });

  test(`미니 플레이어: ${status} 상태에서 실제 재생 중일 때만 움직여요`, () => {
    const np: NowPlayingView = {
      song,
      status,
      positionSec: 0,
      durationSec: 180,
    };

    const html = renderToStaticMarkup(
      <NowPlayingArea np={np} queue={[]} onCancel={() => {}} />,
    );

    expect(html.includes("animate-[eqb_")).toBe(status === "playing");
    expect(html.includes('src=""')).toBe(false);
  });
}

for (const state of ["ready", "loading", "different-song"] as const) {
  test(`정지 확인: ${state} 상태에서 화면과 일치하는 복구 정보가 있어야 체크할 수 있어요`, async () => {
    const recovery: RecoveryState = {
      key: "capture-1",
      fence:
        state === "loading"
          ? null
          : {
              expectedSongId:
                state === "different-song" ? "other-song" : song.id,
              expectedAttemptId: "attempt-1",
              expectedOwnerEpoch: 4,
            },
      pending: state === "loading",
      error: "",
      refresh: () => {},
    };
    const disabled: boolean[] = [];
    const html = renderToStaticMarkup(
      <NowPlayingCard
        np={{
          song,
          status: "waiting",
          positionSec: 0,
          durationSec: 180,
        }}
        recovery={recovery}
        onPrevious={async () => {}}
        onTogglePlayback={async () => {}}
        onSkip={async () => {}}
        onConfirmStopped={async () => {}}
      />,
    );

    await new HTMLRewriter()
      .on('input[type="checkbox"]', {
        element(element) {
          disabled.push(element.hasAttribute("disabled"));
        },
      })
      .transform(new Response(html))
      .text();

    expect(disabled).toEqual([state !== "ready"]);
  });
}
