import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { SCHEMA_DDL } from "./schema";

// libsql 클라이언트: file: URL은 프로세스 CWD 기준이라 서버는 repo 루트에서 실행한다.
export const libsqlClient: Client = createClient({
  url: process.env.DATABASE_URL ?? "file:jukebox.sqlite",
});
export const database = drizzle(libsqlClient);

// 레포지토리가 주입받는 drizzle 핸들 타입. 테스트는 :memory: 클라이언트로 대체한다.
export type Drizzle = typeof database;

export async function initDatabase(): Promise<void> {
  await libsqlClient.execute("PRAGMA journal_mode = WAL;");
  await libsqlClient.executeMultiple(SCHEMA_DDL);
}
