import { Module } from "@fluojs/core";

import { AdminController } from "./controllers/admin.controller";
import { AdminTokenGuard } from "./controllers/admin-token.guard";
import { EventsController } from "./controllers/events.controller";
import { JukeboxController } from "./controllers/jukebox.controller";
import { jukeboxProviders } from "./jukebox/providers";
import { DeviceCookieMiddleware } from "./middleware/device-cookie.middleware";

@Module({
  controllers: [JukeboxController, AdminController, EventsController],
  providers: [...jukeboxProviders, AdminTokenGuard],
  middleware: [DeviceCookieMiddleware],
})
export class AppModule {}
