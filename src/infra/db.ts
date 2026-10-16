import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { backupDatabase } from "./backup";
import { migrateDatabase, readSchemaVersion } from "./migrations";

export type Drizzle = ReturnType<typeof drizzle>;
export type DatabaseConnection = {
  client: Client;
  database: Drizzle;
  sourcePath: string | null;
  existed: boolean;
};

// import만으로 파일을 열지 않고, 부팅 조립 지점에서 명시적으로 생성해요.
export function createDatabase(url: string): DatabaseConnection {
  const sourcePath = url.startsWith("file:")
    ? url.startsWith("file://")
      ? fileURLToPath(url)
      : resolve(url.slice("file:".length))
    : null;
  const existed = sourcePath !== null && existsSync(sourcePath);
  const client = createClient({ url });
  return { client, database: drizzle(client), sourcePath, existed };
}

export async function initDatabase(
  connection: DatabaseConnection,
): Promise<{ backupPath: string | null }> {
  const { client, sourcePath, existed } = connection;
  const version = await readSchemaVersion(client);
  let backupPath: string | null = null;
  if (version === 0) {
    const hasTables =
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
      ).rows.length > 0;
    if (sourcePath && (existed || hasTables)) {
      backupPath = `${sourcePath}.before-v1-${crypto.randomUUID()}.sqlite`;
      await backupDatabase(sourcePath, backupPath);
    }
    await migrateDatabase(client);
  }
  await client.execute("PRAGMA journal_mode = WAL");
  return { backupPath };
}
