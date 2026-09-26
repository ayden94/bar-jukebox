import { type ThemePreference, themeIcon, themeLabel } from "./theme";

const OPTIONS: ThemePreference[] = ["system", "light", "dark"];

type ThemeSegmentProps = {
  theme: ThemePreference;
  onSelect: (pref: ThemePreference) => void;
};

export function ThemeSegment({ theme, onSelect }: ThemeSegmentProps) {
  return (
    <fieldset className="themeseg" aria-label="테마 선택">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`themesegbtn${theme === option ? " active" : ""}`}
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
