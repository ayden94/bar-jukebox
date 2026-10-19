import { inArray } from "drizzle-orm";
import type { Drizzle } from "../../infra/db";
import { settings } from "../../infra/schema";

export type BackgroundHandoff = "after-track" | "immediate";

export type BackgroundSettings = {
  enabled: boolean;
  playlist: string;
  handoff: BackgroundHandoff;
};

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  enabled: false,
  playlist: "",
  handoff: "after-track",
};

const KEYS = {
  enabled: "background_enabled",
  playlist: "background_playlist",
  handoff: "background_handoff",
} as const;

export class BackgroundRepository {
  constructor(private readonly db: Drizzle) {}

  async load(): Promise<BackgroundSettings> {
    const rows = await this.db
      .select()
      .from(settings)
      .where(inArray(settings.key, Object.values(KEYS)));
    const value = (key: string) => rows.find((row) => row.key === key)?.value;
    const handoff = value(KEYS.handoff);
    return {
      enabled: value(KEYS.enabled) === "1",
      playlist: value(KEYS.playlist) ?? DEFAULT_BACKGROUND.playlist,
      handoff:
        handoff === "immediate" || handoff === "after-track"
          ? handoff
          : DEFAULT_BACKGROUND.handoff,
    };
  }

  async save(next: BackgroundSettings): Promise<void> {
    const entries = [
      [KEYS.enabled, next.enabled ? "1" : "0"],
      [KEYS.playlist, next.playlist],
      [KEYS.handoff, next.handoff],
    ] as const;
    await this.db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.insert(settings).values({ key, value }).onConflictDoUpdate({
          target: settings.key,
          set: { value },
        });
      }
    });
  }
}
