import { expect, test } from "bun:test";
import {
  adminNavigationFailurePolicy,
  adminSessionPolicy,
} from "./navigation-policy";

for (const reason of [
  "network",
  "server-error",
  "import-failure",
  "incompatible-build",
] as const) {
  test(`이동 정책: ${reason} 실패는 현재 셸을 보존해요`, async () => {
    expect(
      await adminNavigationFailurePolicy({
        reason,
        destination: "/admin/qr",
        type: "push",
      }),
    ).toBe("preserve");
  });
}

for (const reason of [
  "unauthorized",
  "forbidden",
  "not-found",
  "invalid-payload",
  "unsupported-module",
] as const) {
  test(`이동 정책: ${reason} 실패는 무조건 보존하지 않아요`, async () => {
    expect(
      await adminNavigationFailurePolicy({
        reason,
        destination: "/admin/qr",
        type: "back",
      }),
    ).toBe("document");
  });
}

for (const [reason, expected] of [
  ["unauthorized", "signed-out"],
  ["logout", "signed-out"],
  ["forbidden", "forbidden"],
  ["permissions", "forbidden"],
  ["login", "refresh"],
] as const) {
  test(`세션 정책: ${reason}은 ${expected} 상태로 처리해요`, async () => {
    expect(
      await adminSessionPolicy(
        {
          reason,
          epoch: "test-session",
          destination: "/admin/songs",
        },
        new AbortController().signal,
      ),
    ).toBe(expected);
  });
}
