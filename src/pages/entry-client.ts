import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";

import { AdminDocument } from "./admin";
import { GuestDocument } from "./guest";
import "./styles.css";

const stylesheets = [
  ...document.querySelectorAll<HTMLLinkElement>("link[data-vite-style]"),
]
  .map((link) => link.getAttribute("href"))
  .filter((href): href is string => href !== null);

const dataset = document.documentElement.dataset;
const page = dataset.page ?? "guest";

if (page === "admin") {
  hydrateRoot(document, createElement(AdminDocument, { stylesheets }), {
    identifierPrefix: "jukebox-react-",
  });
} else {
  hydrateRoot(
    document,
    createElement(GuestDocument, {
      error: dataset.error || undefined,
      stylesheets,
      tableLabel: dataset.tableLabel ?? "",
    }),
    { identifierPrefix: "jukebox-react-" },
  );
}
