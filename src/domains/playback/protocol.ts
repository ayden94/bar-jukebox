import type {
  ConnectedTarget,
  NativeBinding,
  PlaybackCommand,
  PlaybackContext,
} from "../../music/contracts";
import type { NowPlaying } from "../shared/types";

export type OwnerIdentity = {
  ownerEpoch: number;
  executorSessionId: string;
};

export type OwnerClaim = {
  executorSessionId: string;
  connection: ConnectedTarget;
};

export type PlaybackOwner = OwnerIdentity & {
  connection: ConnectedTarget;
  heartbeatAt: number;
  released: boolean;
  stopConfirmed: boolean;
};

export type CommandState =
  | "prepared"
  | "sent"
  | "received"
  | "confirmed"
  | "rejected"
  | "unknown";

export type DurableCommand = {
  command: PlaybackCommand;
  ownerEpoch: number;
  state: CommandState;
  createdAt: number;
  updatedAt: number;
};

export type DurableAttempt = {
  attemptId: string;
  songId: string;
  ownerEpoch: number;
  context: PlaybackContext;
  reservedAt: number;
  startedAt: number | null;
  state: NowPlaying["status"] | "finished" | "superseded";
  binding: NativeBinding | null;
  sequence: number;
  positionSec: number | null;
  durationSec: number | null;
};

export type PlaybackReservation = {
  attempt: DurableAttempt;
  command: DurableCommand;
  previousAttemptId?: string;
};

export type PlaybackFence = OwnerIdentity & {
  attemptId: string | null;
};

export type BrowserStoppedFence = PlaybackFence & {
  songId: string | null;
};

// 관리자 전용이에요. public state/SSE에 이 자료를 합치지 않아요.
export type PlaybackSnapshot = {
  owner: PlaybackOwner | null;
  ownerConnected: boolean;
  attempt: DurableAttempt | null;
  commands: DurableCommand[];
};
