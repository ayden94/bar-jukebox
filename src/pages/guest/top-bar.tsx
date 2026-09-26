import type { ThemePreference } from "../theme";

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
        <select
          className="themechoice"
          aria-label="테마 선택"
          value={theme}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "system" || value === "light" || value === "dark") {
              onThemeSelect(value);
            }
          }}
        >
          <option value="system">시스템</option>
          <option value="light">밝게</option>
          <option value="dark">어둡게</option>
        </select>
        <div className="chip">{tableLabel ?? ""}</div>
      </div>
    </header>
  );
}
