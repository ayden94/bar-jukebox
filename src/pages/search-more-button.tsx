type SearchMoreButtonProps = {
  loading: boolean;
  failed: boolean;
  onLoad: () => void;
  className: string;
};

export function SearchMoreButton({
  loading,
  failed,
  onLoad,
  className,
}: SearchMoreButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={loading}
      onClick={onLoad}
    >
      {loading ? "불러오는 중" : failed ? "다시 불러오기" : "∨ 더 보기"}
    </button>
  );
}
