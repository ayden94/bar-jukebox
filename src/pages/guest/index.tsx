import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
} from "@fluojs/react/client";
import { bakedTheme, themePreferenceFromCookie, themeScript } from "../theme";
import { GuestApp } from "./guest-app";

export type GuestDocumentProps = {
  readonly stylesheets: readonly string[];
  readonly tableLabel?: string;
  readonly error?: string;
  readonly theme?: string;
};

export function GuestDocument({
  stylesheets,
  tableLabel,
  error,
  theme,
}: GuestDocumentProps) {
  const routeUrl =
    typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`;

  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot({
        params: {},
        url: routeUrl,
      })}
    >
      <html
        data-error={error ?? ""}
        data-page="guest"
        data-table-label={tableLabel ?? ""}
        data-theme={bakedTheme(theme ?? themePreferenceFromCookie())}
        suppressHydrationWarning={true}
        lang="ko"
      >
        <head>
          <meta charSet="utf-8" />
          <meta
            content="width=device-width, initial-scale=1, viewport-fit=cover"
            name="viewport"
          />
          <meta content="#000000" name="theme-color" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <title>바 주크박스</title>
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
          <GuestApp error={error} tableLabel={tableLabel} />
        </body>
      </html>
    </ReactClientRouterProvider>
  );
}
