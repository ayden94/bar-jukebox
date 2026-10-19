import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SCHEMA_DDL } from "../../infra/schema";
import {
  BackgroundRepository,
  DEFAULT_BACKGROUND,
} from "./background.repository";
import {
  BackgroundService,
  InvalidBackgroundSettingsError,
} from "./background.service";

async function setup() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(SCHEMA_DDL);
  const repository = new BackgroundRepository(drizzle(client));
  return { client, repository, service: new BackgroundService(repository) };
}

test("배경 설정은 저장 후 다시 불러와도 같고 기본값은 꺼져 있어요", async () => {
  const { client, repository, service } = await setup();
  try {
    expect(await repository.load()).toEqual(DEFAULT_BACKGROUND);
    await service.update({
      enabled: true,
      playlist: "  재즈 저녁  ",
      handoff: "immediate",
    });

    expect(service.read()).toEqual({
      enabled: true,
      playlist: "재즈 저녁",
      handoff: "immediate",
    });
    expect(await repository.load()).toEqual(service.read());
  } finally {
    client.close();
  }
});

test("재생 목록 없이 배경을 켜면 메모리와 DB 모두 바꾸지 않아요", async () => {
  const { client, repository, service } = await setup();
  try {
    await expect(service.update({ enabled: true })).rejects.toBeInstanceOf(
      InvalidBackgroundSettingsError,
    );
    expect(service.read()).toEqual(DEFAULT_BACKGROUND);
    expect(await repository.load()).toEqual(DEFAULT_BACKGROUND);
  } finally {
    client.close();
  }
});

test("알 수 없는 저장 값은 안전한 기본 인계로 읽어요", async () => {
  const { client, repository } = await setup();
  try {
    await client.execute(
      "INSERT INTO settings (key, value) VALUES ('background_handoff', 'later')",
    );
    expect((await repository.load()).handoff).toBe("after-track");
  } finally {
    client.close();
  }
});
