export function Hint({
  paused,
  atLimit,
}: {
  paused: boolean;
  atLimit: boolean;
}) {
  if (paused || !atLimit) return null;
  return (
    <div className="mb-3 text-left text-[0.84rem] leading-normal text-[var(--guest-muted)]">
      신청한 곡이 재생 대기 중이에요. 끝나면 또 신청할 수 있어요
    </div>
  );
}
