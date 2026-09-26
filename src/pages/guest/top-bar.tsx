type TopBarProps = {
  theme: "dark" | "light";
  toggleTheme: () => void;
  tableLabel?: string;
};

export function TopBar({ theme, toggleTheme, tableLabel }: TopBarProps) {
  return (
    <header className="top">
      <div className="brand">
        <span className="note">{"♪ "}</span>주크박스
      </div>
      <div className="topright">
        <button
          className="themebtn"
          onClick={toggleTheme}
          type="button"
          aria-label="테마 전환"
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
        <div className="chip">{tableLabel ?? ""}</div>
      </div>
    </header>
  );
}
