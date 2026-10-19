import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Post,
  type RequestContext,
  RequestDto,
  Sse,
  type SseMessage,
  UseGuards,
} from "@fluojs/http";
import { AdminTokenGuard } from "../admin/admin-token.guard";
import { SseBroker } from "../events/sse-broker";
import { BrowserCatalogBridge } from "../music/browser-catalog-bridge";
import { onChange } from "../shared/bus";
import { BrowserPlaybackBridge } from "./browser-playback-bridge";
import {
  ClaimOwnerDto,
  ConfirmBrowserStoppedDto,
  OwnerIdentityDto,
  PlaybackEventsDto,
  PlaybackObservationDto,
  PlaybackReceiptDto,
  PlaybackReconciliationDto,
  parseBrowserStoppedFence,
  parseConnection,
  parseObservation,
  parseOutcome,
  parseReconciliation,
} from "./dto";
import { PlaybackService } from "./playback.service";

function requireCurrent(accepted: boolean): void {
  if (!accepted)
    throw new ConflictException("현재 재생 실행기와 일치하지 않아요");
}

@Inject(PlaybackService, BrowserPlaybackBridge, BrowserCatalogBridge)
@UseGuards(AdminTokenGuard)
@Controller("/api/admin/playback")
export class PlaybackController {
  constructor(
    private readonly playback: PlaybackService,
    private readonly bridge: BrowserPlaybackBridge,
    private readonly catalog: BrowserCatalogBridge,
  ) {}

  @Get("/snapshot")
  async snapshot() {
    return this.playback.snapshot();
  }

  @Sse("/events")
  @RequestDto(PlaybackEventsDto)
  async *events(
    dto: PlaybackEventsDto,
    context: RequestContext,
  ): AsyncIterable<SseMessage<unknown>> {
    const lifetime = new AbortController();
    const signal = context.request.signal
      ? AbortSignal.any([context.request.signal, lifetime.signal])
      : lifetime.signal;
    const broker = new SseBroker();
    const offState = onChange(() => broker.notify());
    const offBridge = this.bridge.subscribe(() => broker.notify());
    const offCatalog = this.catalog.subscribe(() => broker.notify());
    const offCatalogChannel = this.catalog.openChannel(dto.executorSessionId);
    context.response.setHeader("Cache-Control", "private, no-store");
    try {
      while (!signal.aborted) {
        // 스냅샷을 읽기 전에 구독해 조회 사이의 명령 발행을 놓치지 않아요.
        const change = broker.waitChange(signal);
        const snapshot = await this.playback.snapshot();
        yield {
          event: "snapshot",
          data: {
            ...snapshot,
            catalogRequests: snapshot.ownerConnected
              ? this.catalog.requests(dto.executorSessionId)
              : [],
            messages:
              snapshot.owner?.executorSessionId === dto.executorSessionId &&
              !snapshot.owner.released
                ? this.bridge.messages()
                : [],
          },
        };
        const wake = await change;
        if (wake === "closed") return;
        if (wake === "ping") yield { event: "ping", data: {} };
      }
    } finally {
      lifetime.abort();
      offState();
      offBridge();
      offCatalog();
      offCatalogChannel();
    }
  }

  @Post("/owner")
  @RequestDto(ClaimOwnerDto)
  async claim(dto: ClaimOwnerDto) {
    if (!dto.executorSessionId)
      throw new BadRequestException("실행기 식별자가 필요해요");
    return {
      owner: await this.playback.claimOwner({
        executorSessionId: dto.executorSessionId,
        connection: parseConnection(dto.connection),
      }),
    };
  }

  @Post("/heartbeat")
  @RequestDto(OwnerIdentityDto)
  async heartbeat(dto: OwnerIdentityDto) {
    return { owner: await this.playback.heartbeat(dto) };
  }

  @Post("/release")
  @RequestDto(OwnerIdentityDto)
  async release(dto: OwnerIdentityDto) {
    requireCurrent(await this.playback.releaseOwner(dto));
    return { ok: true };
  }

  @Post("/receipt")
  @RequestDto(PlaybackReceiptDto)
  async receipt(dto: PlaybackReceiptDto) {
    const outcome = parseOutcome(dto.outcome);
    requireCurrent(await this.playback.receipt(dto, outcome));
    requireCurrent(this.bridge.acceptReceipt(dto, outcome));
    return { ok: true };
  }

  @Post("/confirm-browser-stopped")
  @RequestDto(ConfirmBrowserStoppedDto)
  async confirmBrowserStopped(dto: ConfirmBrowserStoppedDto) {
    requireCurrent(
      await this.playback.confirmBrowserStopped(parseBrowserStoppedFence(dto)),
    );
    return { ok: true };
  }

  @Post("/observation")
  @RequestDto(PlaybackObservationDto)
  async observation(dto: PlaybackObservationDto) {
    const observation = parseObservation(dto.observation);
    requireCurrent(await this.playback.observation(dto, observation));
    this.bridge.acceptObservation(dto, observation);
    return { ok: true };
  }

  @Post("/reconcile")
  @RequestDto(OwnerIdentityDto)
  async reconcile(dto: OwnerIdentityDto) {
    requireCurrent(await this.playback.authorize(dto));
    return { matched: await this.playback.reconcile(dto) };
  }

  @Post("/reconciliation")
  @RequestDto(PlaybackReconciliationDto)
  async reconciliation(dto: PlaybackReconciliationDto) {
    const result = parseReconciliation(dto.result);
    requireCurrent(await this.playback.authorize(dto));
    requireCurrent(this.bridge.completeReconcile(dto, dto.requestId, result));
    return { ok: true };
  }
}
