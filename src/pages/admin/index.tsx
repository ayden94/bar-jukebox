import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { bakedTheme, themePreferenceFromCookie, themeScript } from "../theme";
import { AdminApp } from "./admin-app";

export type AdminDocumentProps = {
  readonly stylesheets: readonly string[];
  readonly theme?: string;
};

export function AdminDocument({ stylesheets, theme }: AdminDocumentProps) {
  const routeUrl =
    typeof window === "undefined"
      ? "/admin"
      : `${window.location.pathname}${window.location.search}`;

  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot({
        params: {},
        url: routeUrl,
      })}
    >
      <html
        data-theme={bakedTheme(theme ?? themePreferenceFromCookie())}
        suppressHydrationWarning={true}
        data-page="admin"
        lang="ko"
      >
        <head>
          <meta charSet="utf-8" />
          <meta content="width=device-width, initial-scale=1" name="viewport" />
          <title>주크박스 관리</title>
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link
            rel="icon"
            type="image/png"
            sizes="32x32"
            href="/icon-32x32.png"
          />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
        <body>
          <div className="admin-root">
            <AdminApp />
          </div>
        </body>
      </html>
    </ReactClientRouterProvider>
  );
}
