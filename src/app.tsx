import { readFile } from "node:fs/promises";
import { Inject, Module } from "@fluojs/core";
import { DrizzleModule } from "@fluojs/drizzle";
import {
  Controller,
  FromPath,
  Get,
  NotFoundException,
  Redirect,
  type RequestContext,
  RequestDto,
} from "@fluojs/http";
import {
  createReactServerEntry,
  Path,
  ReactModule,
  type ReactPageRenderer,
  Router,
} from "@fluojs/react";
import { createReactViteAssetManifest } from "@fluojs/react/vite";
import { IsString } from "@fluojs/validation";
import { AdminController } from "./domains/admin/admin.controller";
import { AdminTokenGuard } from "./domains/admin/admin-token.guard";
import { AdminPageDto } from "./domains/admin/dto";
import { EventsController } from "./domains/events/events.controller";
import { SseBroker } from "./domains/events/sse-broker";
import { PlaybackService } from "./domains/playback/playback.service";
import { JukeboxBusToken, jukeboxProviders } from "./domains/providers";
import { QueueController } from "./domains/queue/queue.controller";
import { QueueService } from "./domains/queue/queue.service";
import { SearchController } from "./domains/search/search.controller";
import { SearchService } from "./domains/search/search.service";
import { SettingsService } from "./domains/settings/settings.service";
import { GuestQueryDto } from "./domains/table/dto";
import { TableController } from "./domains/table/table.controller";
import { TableService } from "./domains/table/table.service";
import { type Drizzle, database, libsqlClient } from "./infra/db";
import {
  DeviceCookieMiddleware,
  deviceIdOf,
} from "./middleware/device-cookie.middleware";
import { AdminQrDocument, AdminSongsDocument } from "./pages/admin";
import { GuestDocument } from "./pages/guest";

type JukeboxDrizzleTxOptions = NonNullable<
  Parameters<Drizzle["transaction"]>[1]
>;
type JukeboxDrizzleTx = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];

export type CreateJukeboxModuleOptions = {
  readonly clientDirectory: URL;
  readonly manifest: unknown;
};

const ASSET_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:css|js)$/u;

export function createJukeboxModule(options: CreateJukeboxModuleOptions) {
  const manifestResult = createReactViteAssetManifest({
    base: "/assets/",
    entries: {
      client: "src/pages/entry-client.tsx",
      server: "src/pages/entry-server.ts",
    },
    identifierPrefix: "jukebox-react-",
    manifest: options.manifest,
  });
  if (!manifestResult.ok) {
    throw new Error(
      manifestResult.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join("\n"),
    );
  }
  const assets = manifestResult.manifest;
  const renderPage: ReactPageRenderer = (page) =>
    createReactServerEntry(page, assets.hydrationOptions);

  @Inject(TableService)
  @Router()
  class GuestPageRouter {
    constructor(private readonly tableService: TableService) {}

    @Path("/")
    @RequestDto(GuestQueryDto)
    async guest(dto: GuestQueryDto, context: RequestContext) {
      void deviceIdOf(context);
      const tableId = Number(dto.t);
      const table =
        dto.t && dto.k ? await this.tableService.verify(tableId, dto.k) : null;
      if (!table) {
        return (
          <GuestDocument
            error={
              dto.t
                ? "QR 코드가 유효하지 않아요. 직원에게 문의해주세요"
                : "테이블 QR 코드로 접속해주세요"
            }
            stylesheets={assets.css}
            theme={dto.theme}
          />
        );
      }
      return (
        <GuestDocument
          stylesheets={assets.css}
          tableLabel={table.label}
          theme={dto.theme}
        />
      );
    }
  }

  @Router("/admin")
  class AdminPageRouter {
    // 예전 단일 경로(/admin)는 노래 관리로 보낸다 — 해시 시절 북마크는 클라이언트가 이어받는다.
    @Path("/")
    @Redirect("/admin/songs")
    admin() {
      return null;
    }

    @Path("/songs")
    @RequestDto(AdminPageDto)
    songs(dto: AdminPageDto) {
      return <AdminSongsDocument stylesheets={assets.css} theme={dto.theme} />;
    }

    @Path("/qr")
    @RequestDto(AdminPageDto)
    qr(dto: AdminPageDto) {
      return <AdminQrDocument stylesheets={assets.css} theme={dto.theme} />;
    }
  }

  class AssetRequest {
    @IsString()
    @FromPath("file")
    file = "";
  }

  @Controller("/assets")
  class ViteAssetController {
    @Get("/:file")
    @RequestDto(AssetRequest)
    async serve(input: AssetRequest, context: RequestContext) {
      if (!ASSET_FILE_PATTERN.test(input.file)) {
        throw new NotFoundException("Vite asset not found.");
      }
      try {
        const body = await readFile(
          new URL(input.file, options.clientDirectory),
        );
        context.response.setHeader(
          "Content-Type",
          input.file.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
        );
        return body;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new NotFoundException("Vite asset not found.", {
            cause: error,
          });
        }
        throw error;
      }
    }
  }

  const PUBLIC_FILES: Record<string, string> = {
    "favicon.svg": "image/svg+xml",
    "icon-32x32.png": "image/png",
    "icon-16x16.png": "image/png",
    "apple-touch-icon.png": "image/png",
  };

  class PublicFileDto {}

  async function servePublicFile(
    file: string,
    context: RequestContext,
  ): Promise<Uint8Array> {
    context.response.setHeader("Content-Type", PUBLIC_FILES[file] ?? "");
    context.response.setHeader("Cache-Control", "public, max-age=86400");
    try {
      return await readFile(new URL(file, options.clientDirectory));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new NotFoundException("File not found.");
      }
      throw error;
    }
  }

  @Controller()
  class PublicFileController {
    @Get("/favicon.svg")
    @RequestDto(PublicFileDto)
    favicon(_dto: PublicFileDto, context: RequestContext) {
      return servePublicFile("favicon.svg", context);
    }

    @Get("/icon-32x32.png")
    @RequestDto(PublicFileDto)
    icon32(_dto: PublicFileDto, context: RequestContext) {
      return servePublicFile("icon-32x32.png", context);
    }

    @Get("/icon-16x16.png")
    @RequestDto(PublicFileDto)
    icon16(_dto: PublicFileDto, context: RequestContext) {
      return servePublicFile("icon-16x16.png", context);
    }

    @Get("/apple-touch-icon.png")
    @RequestDto(PublicFileDto)
    appleTouch(_dto: PublicFileDto, context: RequestContext) {
      return servePublicFile("apple-touch-icon.png", context);
    }
  }

  // 도메인 싱글턴(providers.ts)은 여기 한 곳에만 등록하고 exports로 공유한다 — 중복 등록 경고 방지.
  // drizzle 핸들을 fluo 라이프사이클에 연결한다 (앱 종료 시 libsql close).
  @Module({
    imports: [
      DrizzleModule.forRoot<Drizzle, JukeboxDrizzleTx, JukeboxDrizzleTxOptions>(
        {
          database,
          dispose: () => libsqlClient.close(),
        },
      ),
    ],
    providers: jukeboxProviders,
    exports: [
      QueueService,
      SettingsService,
      TableService,
      SearchService,
      PlaybackService,
      SseBroker,
      JukeboxBusToken,
    ],
  })
  class JukeboxDomainModule {}

  @Module({
    controllers: [
      QueueController,
      TableController,
      SearchController,
      AdminController,
      EventsController,
      ViteAssetController,
      PublicFileController,
    ],
    providers: [AdminTokenGuard],
    middleware: [DeviceCookieMiddleware],
    imports: [
      JukeboxDomainModule,
      ReactModule.forRoot({
        controllers: [GuestPageRouter, AdminPageRouter],
        imports: [JukeboxDomainModule],
        renderPage,
      }),
    ],
  })
  class JukeboxModule {}

  return JukeboxModule;
}
