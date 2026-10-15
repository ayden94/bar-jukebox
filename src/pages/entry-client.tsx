/// <reference types="vite/client" />
import {
  loadReactInitialNavigationDestination,
  type ReactNavigationModules,
} from "@fluojs/react/client";
import { createElement, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { AppDocument } from "./app-document";
import "./tailwind.css";

const navigationModules: ReactNavigationModules = import.meta.glob<{
  readonly default: (props: Record<string, unknown>) => ReactNode;
}>(["./admin/*-page.tsx", "./guest/page.tsx"]);
const initialJson = document.getElementById("fluo-initial-page")?.textContent;
const buildId = document.documentElement.dataset.buildId;
if (!initialJson || !buildId) {
  throw new Error("초기 페이지 정보가 없어요");
}
const initial = await loadReactInitialNavigationDestination(
  initialJson,
  navigationModules,
  buildId,
);
if (!initial.ok) {
  throw new Error(`초기 페이지를 불러올 수 없어요: ${initial.reason}`);
}
const stylesheets = [
  ...document.querySelectorAll<HTMLLinkElement>("link[data-vite-style]"),
]
  .map((link) => link.getAttribute("href"))
  .filter((href): href is string => href !== null);
const adminModules = Object.fromEntries(
  Object.entries(navigationModules).filter(([key]) =>
    key.startsWith("./admin/"),
  ),
);

hydrateRoot(
  document,
  <AppDocument
    buildId={buildId}
    initialPage={{ json: initialJson, payload: initial.payload }}
    navigationModules={
      initial.payload.destination.module.startsWith("./admin/")
        ? adminModules
        : {}
    }
    page={createElement(initial.component, initial.payload.destination.props)}
    route={{ params: initial.payload.params, url: initial.payload.url }}
    stylesheets={stylesheets}
  />,
  { identifierPrefix: "jukebox-react-" },
);
