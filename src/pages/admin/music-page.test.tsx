import { expect, test } from "bun:test";
import type { ReactNavigationPayload } from "@fluojs/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MusicService } from "../../domains/music/music.service";
import { resolveMusicBootConfig } from "../../domains/music/music-config";
import {
  firstConfig,
  readyState,
  registry,
} from "../../domains/music/test-support";
import { AppDocument } from "../app-document";
import { AdminMusicPage } from "./index";
import MusicPage from "./music-page";
import { MusicConnectionPanel, MusicSettingsPanel } from "./music-panel";
import type { MusicSnapshot } from "./music-types";

async function snapshot(): Promise<MusicSnapshot> {
  return new MusicService(
    { save: async () => {} },
    {
      boot: resolveMusicBootConfig({
        environment: {},
        saved: firstConfig,
        legacyDefault: null,
        registry,
      }),
      registry,
      playbackDisabled: false,
      runtime: { getState: () => readyState },
    },
  ).getSnapshot();
}

test("음악 페이지: 독립 페이지 default export를 관리자 배럴에서 그대로 공개해요", () => {
  expect(AdminMusicPage).toBe(MusicPage);
});

for (const route of ["music", "songs", "qr"]) {
  test(`관리자 문서: ${route} 경로는 같은 셸에서 해당 페이지 식별자를 사용해요`, async () => {
    const url = `http://localhost/admin/${route}`;
    const payload: ReactNavigationPayload = {
      version: 2,
      buildId: "fixture-build",
      url,
      params: {},
      destination: {
        module: `./admin/${route}-page.tsx`,
        props: { theme: "light" },
      },
    };
    const html = renderToStaticMarkup(
      <AppDocument
        page={<div />}
        route={{ url, params: {} }}
        stylesheets={[]}
        buildId="fixture-build"
        initialPage={{ payload, json: JSON.stringify(payload) }}
      />,
    );
    const pages: (string | null)[] = [];

    await new HTMLRewriter()
      .on("html", {
        element(element) {
          pages.push(element.getAttribute("data-page"));
        },
      })
      .transform(new Response(html))
      .text();

    expect(pages).toEqual([`admin-${route}`]);
  });
}

for (const readiness of [
  "setup-required",
  "disabled",
  "ready",
  "connecting",
  "auth-required",
  "unavailable",
  "conflict",
] satisfies MusicSnapshot["readiness"][]) {
  test(`음악 상태 패널: ${readiness} 상태와 음악 권한과 owner를 독립적으로 표시해요`, async () => {
    const model: MusicSnapshot = {
      ...(await snapshot()),
      readiness,
      owner: null,
    };
    const attributes: (string | null)[] = [];
    const html = renderToStaticMarkup(
      <MusicConnectionPanel
        snapshot={model}
        targets={[]}
        pending={false}
        onAction={async () => true}
        onLoadTargets={async () => {}}
      />,
    );

    await new HTMLRewriter()
      .on("[data-readiness]", {
        element(element) {
          attributes.push(element.getAttribute("data-readiness"));
        },
      })
      .on("[data-auth-status]", {
        element(element) {
          attributes.push(element.getAttribute("data-auth-status"));
        },
      })
      .on("[data-owner-location]", {
        element(element) {
          attributes.push(element.getAttribute("data-owner-location"));
        },
      })
      .transform(new Response(html))
      .text();

    expect(attributes).toEqual([readiness, "authorized", "none"]);
  });
}

test("음악 설정 폼: 환경 변수로 잠긴 필드는 비활성화하고 설명과 연결해요", async () => {
  const model: MusicSnapshot = {
    ...(await snapshot()),
    locks: { providerId: true, modeId: false },
  };
  const controls: {
    name: string | null;
    disabled: boolean;
    help: string | null;
  }[] = [];
  const html = renderToStaticMarkup(
    <MusicSettingsPanel
      snapshot={model}
      selected={firstConfig}
      pending={false}
      dirty={false}
      onChange={() => {}}
      onSave={async () => {}}
    />,
  );

  await new HTMLRewriter()
    .on("select", {
      element(element) {
        controls.push({
          name: element.getAttribute("name"),
          disabled: element.hasAttribute("disabled"),
          help: element.getAttribute("aria-describedby"),
        });
      },
    })
    .transform(new Response(html))
    .text();

  expect(controls).toEqual([
    { name: "providerId", disabled: true, help: "music-provider-help" },
    { name: "modeId", disabled: false, help: "music-mode-help" },
  ]);
});

test("음악 연결 패널: 아직 등록되지 않은 브라우저 기기는 연결할 수 없어요", async () => {
  const disabled: boolean[] = [];
  const model = await snapshot();
  const html = renderToStaticMarkup(
    <MusicConnectionPanel
      snapshot={{
        ...model,
        actions: { ...model.actions, connectTarget: true },
      }}
      targets={[
        {
          ref: { ...firstConfig, targetId: "browser" },
          label: "fixture-browser",
          location: "browser",
        },
      ]}
      pending={false}
      onAction={async () => true}
      onLoadTargets={async () => {}}
    />,
  );

  await new HTMLRewriter()
    .on("button", {
      element(element) {
        disabled.push(element.hasAttribute("disabled"));
      },
    })
    .transform(new Response(html))
    .text();

  expect(disabled).toEqual([true]);
});
