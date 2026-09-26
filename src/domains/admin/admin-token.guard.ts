import {
  type Guard,
  type GuardContext,
  UnauthorizedException,
} from "@fluojs/http";

import { ADMIN_TOKEN } from "../shared/config";

/** /api/admin/* 공통 가드: x-admin-token 헤더를 .env의 ADMIN_TOKEN과 대조한다. */
export class AdminTokenGuard implements Guard {
  canActivate(context: GuardContext): boolean {
    const token = context.requestContext.request.headers["x-admin-token"];
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      throw new UnauthorizedException("관리자 인증이 필요해요");
    }
    return true;
  }
}
