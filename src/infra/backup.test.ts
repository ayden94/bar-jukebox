import { afterEach, expect, test } from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Client, createClient } from "@libsql/client";
import { backupDatabase } from "./backup";
import { SCHEMA_DDL } from "./schema";

const clients: Client[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function open(path: string): Client {
  const client = createClient({ url: pathToFileURL(path).href });
  clients.push(client);
  return client;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jukebox-backup-test-"));
  directories.push(directory);
  const source = join(directory, "source.sqlite");
  const destination = join(directory, "snapshot's.sqlite");
  const client = open(source);
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA wal_autocheckpoint = 0");
  await client.executeMultiple(SCHEMA_DDL);
  await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  return { directory, source, destination, client };
}

test("SQLite 백업은 체크포인트 전 WAL의 커밋을 보존하고 원본을 바꾸지 않아요", async () => {
  const { directory, source, destination, client } = await fixture();
  await client.batch(
    [
      "INSERT INTO settings VALUES ('notice', '커밋된 설정')",
      "INSERT INTO tables VALUES (1, '테이블', '복원할 비밀', 123)",
      "INSERT INTO queue VALUES ('a', '{\"id\":\"a\"}', 4)",
      "INSERT INTO history VALUES ('b', '{\"id\":\"b\"}', 2)",
      'INSERT INTO now_playing VALUES (1, \'{"id":"c"}\', 456)',
    ],
    "write",
  );
  const sourceBytes = await readFile(source);
  const walBytes = await readFile(`${source}-wal`);
  expect(walBytes.length).toBeGreaterThan(32);
  const tables = ["settings", "tables", "queue", "history", "now_playing"];
  const before = await Promise.all(
    tables.map(async (table) => ({
      table,
      rows: (await client.execute(`SELECT * FROM ${table}`)).rows,
    })),
  );

  await backupDatabase(source, destination);

  expect(await readFile(source)).toEqual(sourceBytes);
  expect(await readFile(`${source}-wal`)).toEqual(walBytes);
  expect(
    (await readdir(directory)).some((name) =>
      name.startsWith(".jukebox-backup-"),
    ),
  ).toBe(false);
  expect((await stat(destination)).mode & 0o777).toBe(0o600);
  const restored = open(destination);
  expect(
    (await restored.execute("PRAGMA integrity_check")).rows[0]?.integrity_check,
  ).toBe("ok");
  for (const { table, rows } of before) {
    expect((await restored.execute(`SELECT * FROM ${table}`)).rows).toEqual(
      rows,
    );
    expect((await client.execute(`SELECT * FROM ${table}`)).rows).toEqual(rows);
  }
  expect(await Bun.file(`${destination}-wal`).exists()).toBe(false);
  await client.execute("INSERT INTO settings VALUES ('later', '백업 이후')");
  expect(
    (await restored.execute("SELECT * FROM settings WHERE key = 'later'")).rows,
  ).toEqual([]);
});

test("SQLite 백업은 아직 커밋하지 않은 다른 연결의 쓰기를 포함하지 않아요", async () => {
  const { source, destination, client } = await fixture();
  await client.execute("INSERT INTO settings VALUES ('notice', '이전')");
  const transaction = await client.transaction("write");
  try {
    await transaction.execute("UPDATE settings SET value = '미커밋'");

    await backupDatabase(source, destination);

    expect(
      (await open(destination).execute("SELECT value FROM settings")).rows[0]
        ?.value,
    ).toBe("이전");
  } finally {
    await transaction.rollback();
    transaction.close();
  }
});

for (const content of ["", "기존 백업"]) {
  test(`SQLite 백업은 기존 출력 파일을 덮어쓰지 않아요: ${content.length}바이트`, async () => {
    const { directory, source, destination, client } = await fixture();
    await client.execute("INSERT INTO settings VALUES ('notice', '원본')");
    await writeFile(destination, content);
    const sourceBytes = await readFile(source);
    const walBytes = await readFile(`${source}-wal`);

    await expect(backupDatabase(source, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });

    expect(await readFile(destination, "utf8")).toBe(content);
    expect(await readFile(source)).toEqual(sourceBytes);
    expect(await readFile(`${source}-wal`)).toEqual(walBytes);
    expect(
      (await readdir(directory)).some((name) =>
        name.startsWith(".jukebox-backup-"),
      ),
    ).toBe(false);
  });
}

test("SQLite 백업은 원본 경로나 기존 심볼릭 링크를 출력으로 덮어쓰지 않아요", async () => {
  const { source, destination } = await fixture();
  await symlink(source, destination);

  await expect(backupDatabase(source, source)).rejects.toMatchObject({
    code: "EEXIST",
  });
  await expect(backupDatabase(source, destination)).rejects.toMatchObject({
    code: "EEXIST",
  });
});

test("SQLite 백업은 없는 원본을 새 빈 DB로 만들지 않아요", async () => {
  const { directory, destination } = await fixture();
  const missing = join(directory, "missing.sqlite");

  await expect(backupDatabase(missing, destination)).rejects.toMatchObject({
    code: "ENOENT",
  });

  expect(await Bun.file(missing).exists()).toBe(false);
  expect(await Bun.file(destination).exists()).toBe(false);
});

test("SQLite 백업 CLI는 명시한 로컬 경로에 복원 가능한 파일을 저장해요", async () => {
  const { source, destination, client } = await fixture();
  await client.execute("INSERT INTO settings VALUES ('notice', 'CLI 백업')");

  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../../scripts/backup-database.ts"),
      source,
      destination,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);

  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  expect(
    (await open(destination).execute("SELECT value FROM settings")).rows[0]
      ?.value,
  ).toBe("CLI 백업");
});
