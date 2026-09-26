import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import type { ReactNode } from "react";
import { bakedTheme, themePreferenceFromCookie, themeScript } from "../theme";

export type AdminDocumentProps = {
  readonly stylesheets: readonly string[];
  readonly theme?: string;
};

type AdminDocumentShellProps = AdminDocumentProps & {
  readonly children: ReactNode;
  readonly page: "admin-songs" | "admin-qr";
  readonly title: string;
};

export function AdminDocumentShell({
  children,
  page,
  stylesheets,
  theme,
  title,
}: AdminDocumentShellProps) {
  const routeUrl =
    typeof window === "undefined"
      ? page === "admin-qr"
        ? "/admin/qr"
        : "/admin/songs"
      : `${window.location.pathname}${window.location.search}`;

  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot({
        params: {},
        url: routeUrl,
      })}
    >
      <html
        data-page={page}
        data-theme={bakedTheme(theme ?? themePreferenceFromCookie())}
        lang="ko"
        suppressHydrationWarning={true}
      >
        <head>
          <meta charSet="utf-8" />
          <meta content="width=device-width, initial-scale=1" name="viewport" />
          <title>{title}</title>
          <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
          <link
            href="/icon-32x32.png"
            rel="icon"
            sizes="32x32"
            type="image/png"
          />
          <link href="/apple-touch-icon.png" rel="apple-touch-icon" />
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 저장된 테마를 첫 페인트 전에 적용하는 고정 스크립트 */}
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
          {stylesheets.map((href) => (
            <link
              data-vite-style={true}
              href={href}
              key={href}
              rel="stylesheet"
            />
          ))}
        </head>
        <body>{children}</body>
      </html>
    </ReactClientRouterProvider>
  );
}
