import { expect, test } from "bun:test";
import { apiErrorMessage } from "./shared";

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
