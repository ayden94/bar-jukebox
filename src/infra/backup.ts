import { chmod, link, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

// 실행 중인 로컬 DB도 WAL을 포함한 일관된 스냅샷으로 저장해요.
// 복원은 서버를 완전히 멈춘 뒤 기존 DB와 -wal/-shm을 함께 보관하고,
// 이 파일만 원래 DB 경로에 배치한 다음 서버를 다시 시작해요.
export async function backupDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (!(await stat(source)).isFile()) {
    throw new Error("백업 원본은 기존 로컬 SQLite 파일이어야 해요");
  }
  const staging = await mkdtemp(join(dirname(destination), ".jukebox-backup-"));
  try {
    const snapshot = join(staging, "snapshot.sqlite");
    const client = createClient({ url: pathToFileURL(source).href });
    try {
      await client.execute("PRAGMA synchronous = FULL");
      await client.execute({ sql: "VACUUM main INTO ?", args: [snapshot] });
    } finally {
      client.close();
    }
    await chmod(snapshot, 0o600);
    // rename은 기존 파일을 덮어쓰므로, 완성된 파일만 원자적으로 연결해요.
    // 기존 빈 파일이나 심볼릭 링크도 EEXIST로 거부해요.
    await link(snapshot, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
