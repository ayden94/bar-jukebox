import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const THEME_COOKIE = "bj_theme";
const THEME_MAX_AGE = 60 * 60 * 24 * 365;
export const THEME_COLORS = { light: "#ffffff", dark: "#000000" } as const;

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

// 서버는 system/미설정을 해석할 수 없으므로 data-theme에는 구체값만 굽는다.
export function bakedTheme(pref: string | undefined | null): "light" | "dark" {
  return pref === "light" ? "light" : "dark";
}

export function themePreferenceFromCookie(): ThemePreference {
  if (typeof document === "undefined") return "dark";
  const match = document.cookie.match(/(?:^|; )bj_theme=(light|dark|system)/);
  return (match?.[1] as ThemePreference | undefined) ?? "dark";
}

// SSR HTML에 포함되어 첫 페인트 전에 저장된 테마를 적용하는 인라인 스크립트.
// 이전 localStorage 설정을 쿠키로 옮기고, system은 OS 설정으로 해석한다.
export const themeScript = `try{var m=document.cookie.match(/(?:^|; )bj_theme=(light|dark|system)/);var t=m?m[1]:null;if(!t){var s=localStorage.getItem("bj_theme");if(s==="light"||s==="dark"){t=s;document.cookie="bj_theme="+s+";max-age=${THEME_MAX_AGE};path=/;samesite=lax"}}if(t==="system"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}t=t||"dark";document.documentElement.dataset.theme=t;var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",${JSON.stringify(
  THEME_COLORS,
)}[t])}catch(e){}`;

export function themeIcon(pref: ThemePreference): string {
  return pref === "light" ? "☀️" : pref === "dark" ? "🌙" : "💻";
}

export function themeLabel(pref: ThemePreference): string {
  return pref === "light" ? "밝게" : pref === "dark" ? "어둡게" : "시스템";
}

export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>("dark");

  useEffect(() => {
    setPref(themePreferenceFromCookie());
  }, []);

  useEffect(() => {
    if (pref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => {
      applyTheme(systemTheme());
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [pref]);

  const set = (next: ThemePreference) => {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API는 구형 iOS 사파리에서 미지원이라 document.cookie로 쓴다
    document.cookie = `${THEME_COOKIE}=${next}; max-age=${THEME_MAX_AGE}; path=/; samesite=lax`;
    applyTheme(next === "system" ? systemTheme() : next);
    setPref(next);
  };

  return [pref, set];
}
