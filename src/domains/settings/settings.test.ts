import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import { SettingsRepository } from "./settings.repository";
import { InvalidSettingsError, SettingsService } from "./settings.service";

test("잘못된 설정은 메모리와 DB 모두 변경하지 않아요", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(SCHEMA_DDL);
    const repository = new SettingsRepository(drizzle(client));
    const service = new SettingsService(repository);
    await service.update({ notice: "기존 공지" });
    const before = service.read();
    await expect(
      service.update({ requestsPaused: true, notice: "x".repeat(201) }),
    ).rejects.toBeInstanceOf(InvalidSettingsError);
    expect(service.read()).toEqual(before);
    expect(await repository.load()).toEqual(before);
  } finally {
    client.close();
  }
});

test("설정 저장 도중 실패하면 전체 트랜잭션을 되돌려요", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(SCHEMA_DDL);
    const repository = new SettingsRepository(drizzle(client));
    const service = new SettingsService(repository);
    await service.update({ notice: "기존 공지" });
    const before = service.read();
    await client.execute(
      "CREATE TRIGGER reject_notice BEFORE UPDATE ON settings WHEN NEW.key = 'notice' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    await expect(
      service.update({ requestsPaused: true, notice: "새 공지" }),
    ).rejects.toThrow();
    expect(service.read()).toEqual(before);
    expect(await repository.load()).toEqual(before);
  } finally {
    client.close();
  }
});

test("동시 설정 변경은 앞선 수정 값을 보존해요", async () => {
  const saved: unknown[] = [];
  const service = new SettingsService({
    save: async (snapshot) => {
      saved.push(snapshot);
    },
  });
  await Promise.all([
    service.update({ notice: "공지" }),
    service.update({ maxPerDevice: 3 }),
  ]);
  expect(service.read()).toMatchObject({ notice: "공지", maxPerDevice: 3 });
  expect(saved).toHaveLength(2);
});
