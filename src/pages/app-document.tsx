import type { ReactInitialNavigationPage } from "@fluojs/react";
import {
  createReactRouteSnapshot,
  ReactClientRouterProvider,
  type ReactNavigationModules,
  type ReactRouteSnapshotInput,
  useRouterState,
} from "@fluojs/react/client";
import type { ReactElement, ReactNode } from "react";
import {
  adminNavigationFailurePolicy,
  adminSessionPolicy,
} from "./admin/navigation-policy";
import { AdminSession } from "./admin/session";
import {
  bakedTheme,
  THEME_COLORS,
  themePreferenceFromCookie,
  themeScript,
} from "./theme";

type AppDocumentProps = {
  readonly page: ReactElement;
  readonly route: ReactRouteSnapshotInput;
  readonly stylesheets: readonly string[];
  readonly buildId: string;
  readonly initialPage: ReactInitialNavigationPage;
  readonly navigationModules?: ReactNavigationModules;
};

function DocumentShell({
  children,
  stylesheets,
  initialPage,
  buildId,
}: Omit<AppDocumentProps, "page" | "route" | "navigationModules"> & {
  readonly children: ReactNode;
}) {
  const route = useRouterState();
  const isAdmin = initialPage.payload.destination.module.startsWith("./admin/");
  const active = route.pathname === "/admin/qr" ? "qr" : "songs";
  const props = initialPage.payload.destination.props;
  const theme = bakedTheme(
    typeof props.theme === "string" ? props.theme : themePreferenceFromCookie(),
  );
  return (
    <html
      data-build-id={buildId}
      data-page={isAdmin ? `admin-${active}` : "guest"}
      data-theme={theme}
      lang="ko"
      suppressHydrationWarning={true}
    >
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        {!isAdmin && (
          <meta
            content={THEME_COLORS[theme]}
            name="theme-color"
            suppressHydrationWarning={true}
          />
        )}
        {!isAdmin && <meta name="apple-mobile-web-app-capable" content="yes" />}
        <title>
          {isAdmin
            ? `주크박스 관리 · ${active === "qr" ? "QR 관리" : "노래 관리"}`
            : "바 주크박스"}
        </title>
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
      <body>
        {isAdmin ? (
          <AdminSession active={active}>{children}</AdminSession>
        ) : (
          children
        )}
        <script id="fluo-initial-page" type="application/json">
          {initialPage.json}
        </script>
      </body>
    </html>
  );
}

export function AppDocument({
  page,
  route,
  stylesheets,
  buildId,
  initialPage,
  navigationModules,
}: AppDocumentProps) {
  return (
    <ReactClientRouterProvider
      initialSnapshot={createReactRouteSnapshot(route)}
      navigationBuildId={buildId}
      navigationModules={navigationModules}
      failurePolicy={adminNavigationFailurePolicy}
      session={{ epoch: "jukebox-document", policy: adminSessionPolicy }}
    >
      {(destination) => (
        <DocumentShell
          stylesheets={stylesheets}
          initialPage={initialPage}
          buildId={buildId}
        >
          {destination ?? page}
        </DocumentShell>
      )}
    </ReactClientRouterProvider>
  );
}
