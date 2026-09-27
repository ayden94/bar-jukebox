import { type ThemePreference, themeIcon, themeLabel } from "./theme";

const OPTIONS: ThemePreference[] = ["system", "light", "dark"];

type ThemeSegmentProps = {
  theme: ThemePreference;
  onSelect: (pref: ThemePreference) => void;
};

export function ThemeSegment({ theme, onSelect }: ThemeSegmentProps) {
  return (
    <fieldset
      className="m-0 inline-flex min-w-0 items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--card-bg)] p-0.5"
      aria-label="테마 선택"
    >
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`size-[30px] h-7 cursor-pointer rounded-full border-0 bg-transparent text-[0.9rem] leading-none text-[var(--sub)] transition-colors duration-200 ease-[var(--spring)] ${theme === option ? "!bg-[var(--card2)] text-[var(--text)]" : ""}`}
          aria-pressed={theme === option}
          aria-label={`테마: ${themeLabel(option)}`}
          title={themeLabel(option)}
          onClick={() => onSelect(option)}
        >
          {themeIcon(option)}
        </button>
      ))}
    </fieldset>
  );
}
