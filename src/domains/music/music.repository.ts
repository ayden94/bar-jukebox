import { inArray } from "drizzle-orm";
import { type Drizzle, databaseOperation } from "../../infra/db";
import { settings } from "../../infra/schema";
import type { MusicConfig } from "./music-config";

export class MusicRepository {
  constructor(private readonly db: Drizzle) {}

  async load(): Promise<MusicConfig | null> {
    const rows = await databaseOperation(this.db, () =>
      this.db
        .select()
        .from(settings)
        .where(
          inArray(settings.key, ["music_provider", "music_playback_mode"]),
        ),
    );
    if (rows.length === 0) return null;
    return {
      providerId: rows.find((row) => row.key === "music_provider")?.value ?? "",
      modeId:
        rows.find((row) => row.key === "music_playback_mode")?.value ?? "",
    };
  }

  async save(config: MusicConfig): Promise<void> {
    await databaseOperation(this.db, () =>
      this.db.transaction(async (tx) => {
        for (const [key, value] of [
          ["music_provider", config.providerId],
          ["music_playback_mode", config.modeId],
        ] as const) {
          await tx.insert(settings).values({ key, value }).onConflictDoUpdate({
            target: settings.key,
            set: { value },
          });
        }
      }),
    );
  }
}
