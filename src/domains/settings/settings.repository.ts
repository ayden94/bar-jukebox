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

  async save(snapshot: SettingsSnapshot): Promise<void> {
    const entries = [
      ["requests_paused", snapshot.requestsPaused ? "1" : "0"],
      ["notice", snapshot.notice],
      ["max_per_device", String(snapshot.maxPerDevice)],
      ["max_per_table", String(snapshot.maxPerTable)],
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
