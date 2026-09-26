import type { ThemePreference } from "../theme";
import { ThemeSegment } from "../theme-segment";

type TopBarProps = {
  theme: ThemePreference;
  onThemeSelect: (pref: ThemePreference) => void;
  tableLabel?: string;
};

export function TopBar({ theme, onThemeSelect, tableLabel }: TopBarProps) {
  return (
    <header className="top">
      <div className="brand">
        <span className="note">{"♪ "}</span>주크박스
      </div>
      <div className="topright">
        <ThemeSegment theme={theme} onSelect={onThemeSelect} />
        <div className="chip">{tableLabel ?? ""}</div>
      </div>
    </header>
  );
}
