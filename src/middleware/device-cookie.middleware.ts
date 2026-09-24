import type {
  Middleware,
  MiddlewareContext,
  Next,
  RequestContext,
} from "@fluojs/http";
import { setCookie } from "@fluojs/http";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * 모든 응답에 기기 식별자 쿠키(bj_did)를 보장한다.
 * 손님 신원은 닉네임이 아니라 이 기기 id 기준으로 매겨진다.
 */
export class DeviceCookieMiddleware implements Middleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    const existing = context.request.cookies.bj_did;
    if (!existing) {
      const fresh = crypto.randomUUID();
      setCookie(context.response, "bj_did", fresh, {
        httpOnly: true,
        maxAgeSeconds: YEAR_SECONDS,
        path: "/",
        sameSite: "lax",
      });
      context.requestContext.metadata.deviceId = fresh;
    }
    await next();
  }
}

/** 핸들러용: 미들웨어가 발급한 값 또는 요청 쿠키의 기기 id. */
export function deviceIdOf(requestContext: RequestContext): string {
  const fromMeta = requestContext.metadata.deviceId;
  if (typeof fromMeta === "string") return fromMeta;
  return requestContext.request.cookies.bj_did ?? "";
}
