export function Hint({
  paused,
  atLimit,
  hasQueue,
}: {
  paused: boolean;
  atLimit: boolean;
  hasQueue: boolean;
}) {
  const text = paused
    ? "잠시 후에 곡 신청을 받아요"
    : atLimit
      ? "신청한 곡이 재생 대기 중이에요. 끝나면 또 신청할 수 있어요"
      : hasQueue
        ? null
        : "신청하고 싶은 곡을 검색해보세요";
  if (!text) return null;
  return <div className="hint">{text}</div>;
}
