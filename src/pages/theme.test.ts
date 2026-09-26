import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { themeScript } from "./theme";

test.each([
  ["bj_theme=light", null, false, "light", "#ffffff"],
  ["bj_theme=dark", null, true, "dark", "#000000"],
  ["bj_theme=system", null, true, "light", "#ffffff"],
  ["bj_theme=system", null, false, "dark", "#000000"],
  ["", "light", false, "light", "#ffffff"],
] as const)(
  "초기 테마와 브라우저 색상을 함께 복원해요 (%s, %s, %s)",
  (cookie, legacy, prefersLight, expectedTheme, expectedColor) => {
    const meta = {
      attributes: new Map([["content", "#initial"]]),
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
    };
    const document = {
      cookie,
      documentElement: { dataset: { theme: "dark" } },
      querySelector: (selector: string) =>
        selector === 'meta[name="theme-color"]' ? meta : null,
    };

    runInNewContext(themeScript, {
      document,
      localStorage: { getItem: () => legacy },
      window: { matchMedia: () => ({ matches: prefersLight }) },
    });

    expect(document.documentElement.dataset.theme).toBe(expectedTheme);
    expect(meta.attributes.get("content")).toBe(expectedColor);
  },
);
