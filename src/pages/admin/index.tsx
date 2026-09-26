import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { themeScript } from "../theme";
import { AdminApp } from "./admin-app";

export type AdminDocumentProps = {
  readonly stylesheets: readonly string[];
};

export function AdminDocument({ stylesheets }: AdminDocumentProps) {
  const routeUrl =
    typeof window === "undefined"
      ? "/admin"
      : `${window.location.pathname}${window.location.search}`;

  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot({ params: {}, url: routeUrl })}
    >
      <html suppressHydrationWarning={true} data-page="admin" lang="ko">
        <head>
          <meta charSet="utf-8" />
          <meta content="width=device-width, initial-scale=1" name="viewport" />
          <title>주크박스 관리</title>
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
