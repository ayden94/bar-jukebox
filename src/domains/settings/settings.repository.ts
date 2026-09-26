import type { Drizzle } from "../../infra/db";
import { settings } from "../../infra/schema";

export type SettingsSnapshot = { requestsPaused: boolean; notice: string };

export class SettingsRepository {
  constructor(private readonly db: Drizzle) {}

  async load(): Promise<SettingsSnapshot> {
    const rows = await this.db.select().from(settings);
    const paused = rows.find((row) => row.key === "requests_paused");
    const notice = rows.find((row) => row.key === "notice");
    return {
      requestsPaused: paused?.value === "1",
      notice: notice?.value ?? "",
    };
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}
