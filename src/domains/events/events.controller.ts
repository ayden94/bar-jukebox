import { Inject } from "@fluojs/core";
import {
  Controller,
  type RequestContext,
  RequestDto,
  Sse,
  type SseMessage,
} from "@fluojs/http";
import { deviceIdOf } from "../../middleware/device-cookie.middleware";
import type { JukeboxBus } from "../providers";
import { JukeboxBusToken } from "../providers";
import { QueueService } from "../queue/queue.service";
import { SettingsService } from "../settings/settings.service";
import { composeState } from "../shared/state-view";
import { SseBroker } from "./sse-broker";

class EventsDto {}

@Inject(QueueService, SettingsService, SseBroker, JukeboxBusToken)
@Controller()
export class EventsController {
  constructor(
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly broker: SseBroker,
    bus: JukeboxBus,
  ) {
    // 상태 변경/재생 진행률 갱신을 모든 SSE 연결에 알린다
    bus.onChange(() => this.broker.notify());
  }

  @Sse("/api/events")
  @RequestDto(EventsDto)
  async *events(
    _dto: EventsDto,
    context: RequestContext,
  ): AsyncIterable<SseMessage<unknown>> {
    const deviceId = deviceIdOf(context);
    const signal = context.request.signal;
    context.response.setHeader("Cache-Control", "private, no-store");
    yield {
      event: "state",
      data: composeState(this.queue, this.settings, deviceId),
    };
    while (!signal?.aborted) {
      const result = await this.broker.waitChange(signal);
      if (result === "closed") return;
      if (result === "ping") {
        yield { event: "ping", data: "" };
      } else {
        yield {
          event: "state",
          data: composeState(this.queue, this.settings, deviceId),
        };
      }
    }
  }
}
