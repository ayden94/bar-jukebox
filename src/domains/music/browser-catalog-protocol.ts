import type { PlaybackTarget, TrackRef } from "../../music/contracts";

export type BrowserCatalogFence = {
  readonly requestId: string;
  readonly ownerEpoch: number;
  readonly executorSessionId: string;
  readonly target: PlaybackTarget;
  readonly connectionGeneration: string;
};

export type BrowserCatalogOperation =
  | {
      readonly type: "search";
      readonly query: string;
      readonly cursor: string | null;
    }
  | { readonly type: "lookup"; readonly ref: TrackRef };

export type BrowserCatalogRequest = BrowserCatalogFence & {
  readonly deadline: number;
  // 서버 시각을 브라우저 시각과 비교하지 않아요. 첫 수신 이후에는 연장하지 않아요.
  readonly remainingMs: number;
  readonly operation: BrowserCatalogOperation;
};

export function sameCatalogFence(
  left: Omit<BrowserCatalogFence, "requestId">,
  right: Omit<BrowserCatalogFence, "requestId">,
): boolean {
  return (
    left.ownerEpoch === right.ownerEpoch &&
    left.executorSessionId === right.executorSessionId &&
    left.connectionGeneration === right.connectionGeneration &&
    left.target.providerId === right.target.providerId &&
    left.target.modeId === right.target.modeId &&
    left.target.targetId === right.target.targetId
  );
}
