import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  type RequestContext,
  RequestDto,
} from "@fluojs/http";
import { deviceIdOf } from "../../middleware/device-cookie.middleware";
import { SettingsService } from "../settings/settings.service";
import { makeSong } from "../shared/song";
import { composeState } from "../shared/state-view";
import { TableService } from "../table/table.service";
import { CancelDto, RequestSongDto } from "./dto";
import { QueueService } from "./queue.service";

@Inject(QueueService, TableService, SettingsService)
@Controller()
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly tableService: TableService,
    private readonly settings: SettingsService,
  ) {}

  @Get("/api/state")
  state() {
    return composeState(this.queue, this.settings);
  }

  @Post("/api/request")
  @RequestDto(RequestSongDto)
  async request(dto: RequestSongDto, context: RequestContext) {
    const table = await this.tableService.verify(dto.tableId, dto.tableSecret);
    if (!table) {
      throw new ForbiddenException("유효하지 않은 테이블이에요");
    }
    if (this.settings.isRequestsPaused()) {
      throw new ForbiddenException("지금은 곡 신청을 받고 있지 않아요");
    }
    const deviceId = deviceIdOf(context);
    if (!deviceId) {
      throw new ForbiddenException(
        "기기를 확인할 수 없어요. 페이지를 새로고침해주세요",
      );
    }
    if (this.queue.deviceHasActive(deviceId)) {
      throw new ConflictException(
        "이 기기에서 신청한 곡이 아직 대기 중이에요. 그 곡이 재생된 뒤에 또 신청할 수 있어요.",
      );
    }
    if (this.queue.trackIsActive(dto.trackId)) {
      throw new ConflictException("그 곡은 이미 대기열에 있어요");
    }

    const song = makeSong(dto, table.label, deviceId, false);
    this.queue.enqueue(song);
    console.log(
      `+ request: ${song.trackName} — ${song.artistName} (${song.requestedBy})`,
    );
    return { ok: true, song };
  }

  @Post("/api/cancel")
  @RequestDto(CancelDto)
  cancel(dto: CancelDto, context: RequestContext) {
    if (!dto.id) throw new BadRequestException("id가 필요해요");
    const removed = this.queue.removeOwnedFromQueue(
      dto.id,
      deviceIdOf(context),
    );
    return { ok: removed };
  }
}
