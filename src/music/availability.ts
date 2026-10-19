import type { ProviderIdentity } from "./contracts";

// 내부 어댑터의 구현 여부와 별개로 이번 로컬 서버에서 제공하는 방식을 정해요.
export function musicModeUnavailableReason(
  selected: ProviderIdentity,
  platform: string,
): string | null {
  if (
    selected.providerId !== "apple-music" ||
    selected.modeId !== "applescript"
  )
    return "지원 예정";
  return platform === "darwin"
    ? null
    : "이 재생 방식은 macOS의 Music 앱이 필요해요.";
}
