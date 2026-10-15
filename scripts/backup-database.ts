import { backupDatabase } from "../src/infra/backup";

const [source, destination, ...extra] = process.argv.slice(2);
if (!source || !destination || extra.length > 0) {
  console.error(
    "사용법: bun scripts/backup-database.ts <원본 SQLite 파일 경로> <새 백업 파일 경로>",
  );
  process.exitCode = 1;
} else {
  try {
    await backupDatabase(source, destination);
    console.info("SQLite 백업을 저장했어요");
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "SQLite 백업에 실패했어요",
    );
    process.exitCode = 1;
  }
}
