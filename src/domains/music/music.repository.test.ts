import { afterEach, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { databaseOperation } from "../../infra/db";
import { SCHEMA_DDL } from "../../infra/schema";
import { MusicRepository } from "./music.repository";
import { firstConfig, secondConfig } from "./test-support";

const clients: Client[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(SCHEMA_DDL);
  return { client, repository: new MusicRepository(drizzle(client)) };
}

test("음악 설정 저장소: 새 설치에는 저장한 다음 시작 설정이 없어요", async () => {
  const { repository } = await fixture();

  expect(await repository.load()).toBeNull();
});

test("음악 설정 저장소: 재시작 후에도 설정을 복원하고 기존 운영 설정을 보존해요", async () => {
  const { client, repository } = await fixture();
  await client.execute("INSERT INTO settings VALUES ('notice', 'fixture')");
  await repository.save(firstConfig);
  await repository.save(secondConfig);

  const restored = await new MusicRepository(drizzle(client)).load();

  expect(restored).toEqual(secondConfig);
  expect(
    (await client.execute("SELECT value FROM settings WHERE key = 'notice'"))
      .rows[0]?.value,
  ).toBe("fixture");
});

test("음악 설정 저장소: 두 번째 필드 저장 실패 시 첫 필드도 롤백해요", async () => {
  const { client, repository } = await fixture();
  await repository.save(firstConfig);
  await client.execute(`
    CREATE TRIGGER reject_music_mode BEFORE UPDATE ON settings
    WHEN NEW.key = 'music_playback_mode'
    BEGIN SELECT RAISE(ABORT, 'fixture-failure'); END;
  `);

  await expect(repository.save(secondConfig)).rejects.toMatchObject({
    cause: { message: expect.stringContaining("fixture-failure") },
  });

  expect(await repository.load()).toEqual(firstConfig);
});

test("음악 설정 저장소: 불완전한 저장값은 기본값으로 바꾸지 않고 검증에 넘겨요", async () => {
  const { client, repository } = await fixture();
  await client.execute({
    sql: "INSERT INTO settings VALUES ('music_provider', ?)",
    args: [firstConfig.providerId],
  });

  expect(await repository.load()).toEqual({
    providerId: firstConfig.providerId,
    modeId: "",
  });
});

test("음악 설정 저장은 진행 중인 재생 트랜잭션이 끝난 뒤 같은 연결을 사용해요", async () => {
  const { client } = await fixture();
  const database = drizzle(client);
  const repository = new MusicRepository(database);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transaction = database.transaction.bind(database);
  let calls = 0;
  database.transaction = (...args) => {
    calls += 1;
    return transaction(...args);
  };
  const playing = databaseOperation(database, () =>
    database.transaction(async () => {
      entered.resolve();
      await release.promise;
    }),
  );
  await entered.promise;
  const saving = repository.save(firstConfig);
  void saving.catch(() => undefined);
  try {
    expect(calls).toBe(1);
  } finally {
    release.resolve();
    await playing;
  }
  await saving;
  expect(calls).toBe(2);
  expect(await repository.load()).toEqual(firstConfig);
});
