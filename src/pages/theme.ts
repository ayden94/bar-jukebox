import { useEffect, useState } from "react";

// SSR HTML에 포함되어 첫 페인트 전에 저장된 테마를 적용하는 인라인 스크립트
export const themeScript = `try{var t=localStorage.getItem("bj_theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export function useTheme(): ["dark" | "light", () => void] {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") setTheme(current);
  }, []);
  const toggle = () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("bj_theme", next);
    } catch {}
    setTheme(next);
  };
  return [theme, toggle];
}
