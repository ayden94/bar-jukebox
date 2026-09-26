import type { Drizzle } from "../../infra/db";
import { settings } from "../../infra/schema";

export type SettingsSnapshot = {
  requestsPaused: boolean;
  notice: string;
  maxPerDevice: number;
  maxPerTable: number;
};

export const DEFAULT_MAX_PER_DEVICE = 1;
export const DEFAULT_MAX_PER_TABLE = 5;

function parseLimit(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export class SettingsRepository {
  constructor(private readonly db: Drizzle) {}

  async load(): Promise<SettingsSnapshot> {
    const rows = await this.db.select().from(settings);
    const paused = rows.find((row) => row.key === "requests_paused");
    const notice = rows.find((row) => row.key === "notice");
    const maxPerDevice = rows.find((row) => row.key === "max_per_device");
    const maxPerTable = rows.find((row) => row.key === "max_per_table");
    return {
      requestsPaused: paused?.value === "1",
      notice: notice?.value ?? "",
      maxPerDevice: parseLimit(maxPerDevice?.value, DEFAULT_MAX_PER_DEVICE),
      maxPerTable: parseLimit(maxPerTable?.value, DEFAULT_MAX_PER_TABLE),
    };
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}
