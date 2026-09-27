import type { ThemePreference } from "../theme";

type TopBarProps = {
  theme: ThemePreference;
  onThemeSelect: (pref: ThemePreference) => void;
  tableLabel?: string;
};

export function TopBar({ theme, onThemeSelect, tableLabel }: TopBarProps) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3 pt-4 pb-5 max-[420.001px]:flex-wrap max-[420.001px]:pb-3.5">
      <div className="shrink-0 text-[1.35rem] font-extrabold tracking-[-0.055em] max-[420.001px]:text-[1.2rem]">
        <span className="text-[var(--guest-accent)]">{"♪ "}</span>주크박스
      </div>
      <div className="flex min-w-0 items-center gap-2 max-[420.001px]:ml-auto">
        <select
          className="min-h-11 min-w-0 max-w-22 cursor-pointer rounded-lg border-0 bg-[var(--bg)] px-1 text-[0.78rem] text-[var(--guest-muted)]"
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
        <div className="min-w-0 max-w-[105px] overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--guest-ink)_6%,transparent)] px-2.5 py-1.5 text-xs font-bold text-[var(--guest-ink)] max-[420.001px]:max-w-[78px]">
          {tableLabel ?? ""}
        </div>
      </div>
    </header>
  );
}
