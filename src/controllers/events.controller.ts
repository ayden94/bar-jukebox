import { Inject } from "@fluojs/core";
import {
  Controller,
  type RequestContext,
  Sse,
  type SseMessage,
} from "@fluojs/http";

import type { JukeboxBus } from "../jukebox/providers";
import { JukeboxBusToken, JukeboxStateToken } from "../jukebox/providers";
import { SseBroker } from "../jukebox/sse-broker";
import type { JukeboxStateStore } from "../jukebox/state";

const PING_INTERVAL_MS = 25000;

@Inject(JukeboxStateToken, SseBroker, JukeboxBusToken)
@Controller()
export class EventsController {
  constructor(
    private readonly state: JukeboxStateStore,
    private readonly broker: SseBroker,
    bus: JukeboxBus,
  ) {
    // 상태 변경/재생 진행률 갱신을 모든 SSE 연결에 알린다
    bus.onChange(() => this.broker.notify());
  }

  @Sse("/api/events")
  async *events(context: RequestContext): AsyncIterable<SseMessage<unknown>> {
    void context;
    yield { event: "state", data: this.state.snapshot() };
    while (true) {
      const result = await Promise.race([
        this.broker.waitChange(),
        new Promise<"ping">((resolve) =>
          setTimeout(resolve, PING_INTERVAL_MS, "ping"),
        ),
      ]);
      if (result === "ping") {
        yield { event: "ping", data: "" };
      } else {
        yield { event: "state", data: this.state.snapshot() };
      }
    }
  }
}
