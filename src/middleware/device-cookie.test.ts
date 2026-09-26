import { expect, test } from "bun:test";
import { signDeviceId, verifyDeviceCookie } from "./device-cookie.middleware";

test("서명된 기기 쿠키만 같은 신원으로 복원해요", () => {
  const id = crypto.randomUUID();
  const cookie = signDeviceId(id, "test-secret");
  expect(verifyDeviceCookie(cookie, "test-secret")).toBe(id);
  expect(verifyDeviceCookie(id, "test-secret")).toBeNull();
  expect(verifyDeviceCookie(cookie, "other-secret")).toBeNull();
  expect(
    verifyDeviceCookie(
      `${crypto.randomUUID()}.${cookie.split(".")[1]}`,
      "test-secret",
    ),
  ).toBeNull();
});
