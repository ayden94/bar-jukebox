import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { createElement, useEffect, useState } from "react";

export type AdminDocumentProps = {
  readonly stylesheets: readonly string[];
};

function HydrationProbe() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
  }, []);
  return null;
}

export function AdminDocument({ stylesheets }: AdminDocumentProps) {
  const [probeCount, setProbeCount] = useState(0);

  return createElement(
    ReactClientRouterProvider,
    {
      initialSnapshot: createReactRouteSnapshot({
        params: {},
        url:
          typeof window === "undefined"
            ? "/admin"
            : `${window.location.pathname}${window.location.search}`,
      }),
    },
    createElement(
      "html",
      { "data-page": "admin", lang: "ko" },
      createElement(
        "head",
        null,
        createElement("meta", { charSet: "utf-8" }),
        createElement("meta", {
          content: "width=device-width, initial-scale=1",
          name: "viewport",
        }),
        createElement("title", null, "주크박스 관리 (fluo React)"),
        ...stylesheets.map((href) =>
          createElement("link", {
            "data-vite-style": true,
            href,
            key: href,
            rel: "stylesheet",
          }),
        ),
      ),
      createElement(
        "body",
        null,
        createElement(HydrationProbe),
        createElement(
          "main",
          null,
          createElement("h1", null, "주크박스 관리 (fluo React)"),
          createElement("p", null, `hydration 프로브: ${probeCount}`),
          createElement(
            "button",
            { onClick: () => setProbeCount((v) => v + 1), type: "button" },
            "probe+1",
          ),
        ),
      ),
    ),
  );
}
