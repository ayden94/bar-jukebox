import { Inject } from "@fluojs/core";
import { Controller, Get } from "@fluojs/http";

import { JukeboxStateToken } from "../jukebox/providers";
import type { JukeboxStateStore } from "../jukebox/state";

@Inject(JukeboxStateToken)
@Controller("/api/health")
export class SmokeController {
  constructor(private readonly state: JukeboxStateStore) {}

  @Get()
  health() {
    return {
      ok: true,
      framework: "fluo",
      runtime: "bun",
      queueLength: this.state.snapshot().queue.length,
    };
  }
}
