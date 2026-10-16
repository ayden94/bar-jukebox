import { expect, test } from "bun:test";
import { apiErrorMessage, art, trackKey } from "./shared";

test("커버 참조: 불투명한 식별자는 프록시 쿼리에서 그대로 복원돼요", () => {
  const artwork = { providerId: "provider/a", artworkId: "a?b=1&c=한글+#" };

  const url = new URL(art(artwork)!, "https://jukebox.test");

  expect(url.pathname).toBe("/api/artwork");
  expect([...url.searchParams]).toEqual([
    ["providerId", artwork.providerId],
    ["artworkId", artwork.artworkId],
  ]);
});

test("커버 참조: 커버가 없으면 이미지 요청 주소를 만들지 않아요", () => {
  expect(art(null)).toBeUndefined();
});

test("트랙 키: 같은 트랙 번호도 제공자가 다르면 구분해요", () => {
  expect(trackKey({ providerId: "one", trackId: "123" })).not.toBe(
    trackKey({ providerId: "two", trackId: "123" }),
  );
  expect(trackKey({ providerId: "one:two", trackId: "three" })).not.toBe(
    trackKey({ providerId: "one", trackId: "two:three" }),
  );
});

test("구조화된 API 오류에서 메시지 문자열을 추출해요", () => {
  const body = {
    error: {
      code: "BAD_REQUEST",
      message: "validation-result",
      status: 400,
    },
  };
  expect(apiErrorMessage(body, "fallback")).toBe("validation-result");
});

test("오류 본문이 없거나 메시지가 문자열이 아니면 기본값을 사용해요", () => {
  for (const body of [null, {}, { error: { message: {} } }]) {
    expect(apiErrorMessage(body, "fallback")).toBe("fallback");
  }
});
