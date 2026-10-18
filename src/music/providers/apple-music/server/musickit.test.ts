import { expect, test } from "bun:test";
import { createAppleMusicKitServer, getMusicKitDeveloperToken } from "./index";

const now = 2000000000000;
const signal = new AbortController().signal;
function token(
  payload: unknown = { iss: "fixture", iat: 1999999900, exp: 2000000100 },
  header: unknown = { alg: "ES256", kid: "fixture" },
) {
  return [
    Buffer.from(JSON.stringify(header)).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    Buffer.alloc(64, 1).toString("base64url"),
  ].join(".");
}

test("개발자 토큰: 형식과 만료 검사는 서명 검증이나 사용자 인증을 뜻하지 않아요", async () => {
  const developerToken = token();
  const created = await createAppleMusicKitServer(
    { developerToken, now: () => now },
    signal,
  );
  if (!created.ok) throw new Error(created.error.code);

  try {
    expect(getMusicKitDeveloperToken(developerToken, now)).toEqual({
      ok: true,
      value: { developerToken },
    });
    expect(created.value.execution).toEqual({ location: "browser" });
    expect(created.value.identity).toEqual({
      providerId: "apple-music",
      modeId: "musickit",
    });
    expect(created.value.auth.getState()).toMatchObject({
      status: "reauth-required",
      authorization: "none",
    });
    expect(await created.value.auth.connect(signal)).toEqual({
      ok: false,
      error: { code: "auth-required" },
    });
    expect(JSON.stringify(created.value)).not.toContain(developerToken);
  } finally {
    await created.value.dispose();
  }
});

test("개발자 토큰: 부재와 잘못된 입력 및 만료는 비밀 없는 설정 오류예요", () => {
  const payload = { iss: "fixture", iat: 1999999900, exp: 2000000100 };
  for (const value of [
    undefined,
    "",
    "secret",
    "a.b.c",
    `${token()}.extra`,
    ` ${token()}`,
    "x".repeat(16385),
    token(null),
    token([]),
    token({ ...payload, exp: "2000000100" }),
    token({ ...payload, exp: 2000000000 }),
    token({ ...payload, exp: 0 }),
    token({ ...payload, exp: 2000000100.5 }),
    token({ ...payload, iat: 2000000001 }),
    token({ ...payload, iss: "" }),
    token(payload, { alg: "none", kid: "fixture" }),
    token(payload, { alg: "ES256" }),
    token().replace(/[^.]+$/, "fake"),
  ]) {
    expect(getMusicKitDeveloperToken(value, now)).toEqual({
      ok: false,
      error: { code: "configuration" },
    });
  }
});

test("MusicKit 준비: 토큰 없이도 카탈로그와 artwork를 제공하고 외부 초기화는 하지 않아요", async () => {
  let requests = 0;
  const created = await createAppleMusicKitServer(
    {
      fetch: async () => {
        requests++;
        return Response.json({ results: [] });
      },
    },
    signal,
  );
  if (!created.ok) throw new Error(created.error.code);

  try {
    expect(requests).toBe(0);
    expect(created.value.auth.getState().authorization).toBe("none");
    expect(await created.value.auth.connect(signal)).toEqual({
      ok: false,
      error: { code: "configuration" },
    });
    expect(await created.value.catalog.search("노래", null, signal)).toEqual({
      ok: true,
      value: { tracks: [], nextCursor: null },
    });
    expect(requests).toBe(1);
    expect(
      await created.value.artwork.fetch(
        { providerId: "apple-music", artworkId: "http://localhost/secret" },
        signal,
      ),
    ).toEqual({ ok: false, error: { code: "invalid-track" } });
    expect(requests).toBe(1);
  } finally {
    await created.value.dispose();
  }
});

test("MusicKit 수명: 만료와 반복 취소 및 정리 뒤에 준비 상태를 재사용하지 않아요", async () => {
  let clock = now;
  const options = { developerToken: token(), now: () => clock };
  const created = await createAppleMusicKitServer(options, signal);
  if (!created.ok) throw new Error(created.error.code);
  try {
    for (let interruption = 0; interruption < 3; interruption++) {
      const cancelled = AbortSignal.abort(new Error("취소"));
      await expect(
        createAppleMusicKitServer(options, cancelled),
      ).rejects.toThrow("취소");
      await expect(created.value.auth.connect(cancelled)).rejects.toThrow(
        "취소",
      );
      expect(await created.value.auth.connect(signal)).toEqual({
        ok: false,
        error: { code: "auth-required" },
      });
    }
    clock += 100000;
    expect(await created.value.auth.connect(signal)).toEqual({
      ok: false,
      error: { code: "configuration" },
    });
    await created.value.dispose();
    await created.value.dispose();
    expect(await created.value.auth.connect(signal)).toEqual({
      ok: false,
      error: { code: "disconnected" },
    });
    expect(await created.value.catalog.search("노래", null, signal)).toEqual({
      ok: false,
      error: { code: "disconnected" },
    });
  } finally {
    await created.value.dispose();
  }
});

test("MusicKit 정리: 응답 없는 카탈로그 요청도 dispose가 취소해요", async () => {
  const entered = Promise.withResolvers<AbortSignal>();
  const created = await createAppleMusicKitServer(
    {
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const requestSignal = init.signal!;
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true },
          );
          entered.resolve(requestSignal);
        }),
    },
    signal,
  );
  if (!created.ok) throw new Error(created.error.code);
  const pending = created.value.catalog.search("노래", null, signal);
  const requestSignal = await entered.promise;

  await created.value.dispose();

  expect(requestSignal.aborted).toBe(true);
  expect(await pending).toEqual({
    ok: false,
    error: { code: "disconnected" },
  });
});
