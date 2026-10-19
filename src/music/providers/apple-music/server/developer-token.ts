import type { MusicResult } from "../../../contracts/index";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 전달 전 형식과 명백한 만료만 검사해요. 발급자 서명이나 Apple의 승인은 검증하지 않아요.
export function getMusicKitDeveloperToken(
  token: string | undefined,
  now = Date.now(),
): MusicResult<{ developerToken: string }> {
  const invalid = { ok: false, error: { code: "configuration" } } as const;
  if (!token || token.length > 16384) return invalid;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part))) {
    return invalid;
  }
  try {
    const header: unknown = JSON.parse(
      Buffer.from(parts[0]!, "base64url").toString("utf8"),
    );
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    );
    if (
      !record(header) ||
      header.alg !== "ES256" ||
      typeof header.kid !== "string" ||
      !header.kid.trim() ||
      !record(payload) ||
      typeof payload.iss !== "string" ||
      !payload.iss.trim() ||
      typeof payload.iat !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat < 0 ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= payload.iat ||
      payload.iat > Math.floor(now / 1000) ||
      payload.exp <= Math.floor(now / 1000) ||
      Buffer.from(parts[2]!, "base64url").length !== 64
    ) {
      return invalid;
    }
    return { ok: true, value: { developerToken: token } };
  } catch {
    return invalid;
  }
}
