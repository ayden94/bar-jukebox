import assert from "node:assert/strict";
import { resolve } from "node:path";
import { armCondition, expectCondition } from "./browser-lifecycle";

export const evidence = resolve(
  ".omo/evidence/boot-selected-music-playback/task-13-ui",
);
export const state = (value: string) =>
  `document.querySelector("[data-preparation]")?.dataset.preparation === ${JSON.stringify(value)}`;

export async function click(
  view: Bun.WebView,
  selector: string,
  condition: string,
) {
  await armCondition(view, condition);
  await view.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:"center"})`,
  );
  await view.click(selector);
  await expectCondition(view, selector);
}

export async function open(url: string) {
  const view = new Bun.WebView({
    backend: { type: "chrome", url: false },
    width: 1280,
    height: 900,
  });
  try {
    await view.navigate(`${url}/admin/music`);
    await armCondition(
      view,
      '!!document.querySelector("#admin-password") || !!document.querySelector("[data-active-mode]")',
    );
    await expectCondition(view, "관리자 로그인");
    if (!(await view.evaluate('!!localStorage.getItem("bj_admin")'))) {
      await view.click("#admin-password");
      await view.type("qa-local-only");
      await click(
        view,
        'button[type="submit"]',
        '!!document.querySelector("[data-active-mode]")',
      );
    }
    await armCondition(view, '!!document.querySelector("[data-active-mode]")');
    await expectCondition(view, "음악 연결 화면");
    return view;
  } catch (error) {
    await view[Symbol.asyncDispose]();
    throw error;
  }
}

export async function capture(view: Bun.WebView, name: string) {
  const measurements = [];
  for (const theme of ["light", "dark"]) {
    await view.evaluate(`document.documentElement.dataset.theme = "${theme}"`);
    for (const [width, height] of [
      [1280, 900],
      [390, 844],
    ] as const) {
      await view.cdp("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      const dimensions = await view.evaluate<{
        width: number;
        scroll: number;
      }>("({width: innerWidth, scroll: document.documentElement.scrollWidth})");
      assert(dimensions.scroll <= dimensions.width, "가로 넘침이 없어요");
      measurements.push({ theme, width, height, ...dimensions });
      await Bun.write(
        `${evidence}/${name}-${theme}-${width}.png`,
        await view.screenshot(),
      );
    }
  }
  return measurements;
}
