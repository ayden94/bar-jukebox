import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  Middleware,
  MiddlewareContext,
  Next,
  RequestContext,
} from "@fluojs/http";
import { setCookie } from "@fluojs/http";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function signDeviceId(id: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(`bj_did:${id}`)
    .digest("base64url");
  return `${id}.${signature}`;
}

export function verifyDeviceCookie(
  cookie: string | undefined,
  secret: string,
): string | null {
  if (!cookie) return null;
  const [id, signature, extra] = cookie.split(".");
  if (
    !id ||
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !signature ||
    extra !== undefined
  ) {
    return null;
  }
  const expected = Buffer.from(signDeviceId(id, secret));
  const supplied = Buffer.from(cookie);
  return expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
    ? id
    : null;
}

/**
 * 모든 응답에 기기 식별자 쿠키(bj_did)를 보장한다.
 * 손님 신원은 닉네임이 아니라 이 기기 id 기준으로 매겨진다.
 */
export class DeviceCookieMiddleware implements Middleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    const secret = process.env.DEVICE_COOKIE_SECRET ?? process.env.ADMIN_TOKEN;
    if (!secret) {
      throw new Error("DEVICE_COOKIE_SECRET 또는 ADMIN_TOKEN이 필요해요");
    }
    const existing = verifyDeviceCookie(context.request.cookies.bj_did, secret);
    const deviceId = existing ?? crypto.randomUUID();
    context.requestContext.metadata.deviceId = deviceId;
    if (!existing) {
      setCookie(context.response, "bj_did", signDeviceId(deviceId, secret), {
        httpOnly: true,
        maxAgeSeconds: YEAR_SECONDS,
        path: "/",
        sameSite: "lax",
      });
    }
    await next();
  }
}

/** 핸들러는 미들웨어가 검증한 신원만 사용한다. */
export function deviceIdOf(requestContext: RequestContext): string {
  const fromMeta = requestContext.metadata.deviceId;
  if (typeof fromMeta === "string") return fromMeta;
  return "";
}
