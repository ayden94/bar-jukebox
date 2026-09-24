import { Module } from "@fluojs/core";

import { SmokeController } from "./controllers/smoke.controller";
import { jukeboxProviders } from "./jukebox/providers";

@Module({
  controllers: [SmokeController],
  providers: jukeboxProviders,
})
export class AppModule {}
