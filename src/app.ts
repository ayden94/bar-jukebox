import { readFile } from "node:fs/promises";
import { Inject, Module } from "@fluojs/core";
import {
  Controller,
  FromPath,
  Get,
  NotFoundException,
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
import { createElement } from "react";

import { AdminController } from "./controllers/admin.controller";
import { AdminTokenGuard } from "./controllers/admin-token.guard";
import { GuestQueryDto } from "./controllers/dto";
import { EventsController } from "./controllers/events.controller";
import { JukeboxController } from "./controllers/jukebox.controller";
import * as db from "./jukebox/db";
import type { JukeboxDatabase } from "./jukebox/providers";
import {
  JukeboxDatabaseToken,
  JukeboxStateToken,
  jukeboxProviders,
} from "./jukebox/providers";
import type { JukeboxStateStore } from "./jukebox/state";
import { state } from "./jukebox/state";
import {
  DeviceCookieMiddleware,
  deviceIdOf,
} from "./middleware/device-cookie.middleware";
import { AdminDocument } from "./pages/admin";
import { GuestDocument } from "./pages/guest";

export type CreateJukeboxModuleOptions = {
  readonly clientDirectory: URL;
  readonly manifest: unknown;
};

const ASSET_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:css|js)$/u;

export function createJukeboxModule(options: CreateJukeboxModuleOptions) {
  const manifestResult = createReactViteAssetManifest({
    base: "/assets/",
    entries: {
      client: "src/pages/entry-client.ts",
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

  @Inject(JukeboxDatabaseToken, JukeboxStateToken)
  @Router()
  class GuestPageRouter {
    constructor(
      private readonly jukeboxDb: JukeboxDatabase,
      private readonly jukeboxState: JukeboxStateStore,
    ) {}

    @Path("/")
    @RequestDto(GuestQueryDto)
    guest(dto: GuestQueryDto, context: RequestContext) {
      void deviceIdOf(context);
      const tableId = Number(dto.t);
      const table = dto.t && dto.k ? this.jukeboxDb.getTable(tableId) : null;
      if (!table || table.secret !== dto.k) {
        return createElement(GuestDocument, {
          error: dto.t
            ? "QR 코드가 유효하지 않아요. 직원에게 문의해주세요"
            : "테이블 QR 코드로 접속해주세요",
          stylesheets: assets.css,
        });
      }
      void this.jukeboxState;
      return createElement(GuestDocument, {
        stylesheets: assets.css,
        tableLabel: table.label,
      });
    }
  }

  @Router("/admin")
  class AdminPageRouter {
    @Path("/")
    admin() {
      return createElement(AdminDocument, { stylesheets: assets.css });
    }
  }

  class AssetRequest {
    @IsString() @FromPath("file") file = "";
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

  @Module({
    controllers: [
      JukeboxController,
      AdminController,
      EventsController,
      ViteAssetController,
    ],
    providers: [...jukeboxProviders, AdminTokenGuard],
    middleware: [DeviceCookieMiddleware],
    imports: [
      ReactModule.forRoot({
        controllers: [GuestPageRouter, AdminPageRouter],
        providers: [
          { provide: JukeboxDatabaseToken, useValue: db },
          { provide: JukeboxStateToken, useValue: state },
        ],
        renderPage,
      }),
    ],
  })
  class JukeboxModule {}

  return JukeboxModule;
}
