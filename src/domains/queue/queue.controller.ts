import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Post,
  type RequestContext,
  RequestDto,
} from "@fluojs/http";
import { deviceIdOf } from "../../middleware/device-cookie.middleware";
import { SearchService, SongLookupError } from "../search/search.service";
import { SettingsService } from "../settings/settings.service";
import { makeSong } from "../shared/song";
import { composeState, publicSong } from "../shared/state-view";
import { TableService } from "../table/table.service";
import { CancelDto, RequestSongDto } from "./dto";
import { QueueService } from "./queue.service";

class StateDto {}

@Inject(QueueService, TableService, SettingsService, SearchService)
@Controller()
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly tableService: TableService,
    private readonly settings: SettingsService,
    private readonly search: SearchService,
  ) {}

  @Get("/api/state")
  @RequestDto(StateDto)
  state(_dto: StateDto, context: RequestContext) {
    context.response.setHeader("Cache-Control", "private, no-store");
    return composeState(this.queue, this.settings, deviceIdOf(context));
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

    const hit = await lookupSong(this.search, dto.trackId);
    if (this.settings.isRequestsPaused()) {
      throw new ForbiddenException("지금은 곡 신청을 받고 있지 않아요");
    }
    const song = makeSong(hit, table.label, deviceId, false, dto.tableId);
    const limits = this.settings.read();
    const denied = await this.queue.enqueue(song, {
      maxPerDevice: limits.maxPerDevice,
      maxPerTable: limits.maxPerTable,
    });
    if (denied === "device-limit") {
      throw new ConflictException(
        limits.maxPerDevice === 1
          ? "이 기기에서 신청한 곡이 아직 대기 중이에요. 그 곡이 재생된 뒤에 또 신청할 수 있어요."
          : `한 기기당 최대 ${limits.maxPerDevice}곡까지만 대기열에 올릴 수 있어요. 재생되면 다시 신청할 수 있어요.`,
      );
    }
    if (denied === "table-limit") {
      throw new ConflictException(
        `테이블당 최대 ${limits.maxPerTable}곡까지만 대기열에 올릴 수 있어요. 한 곡이 재생되면 다시 신청할 수 있어요.`,
      );
    }
    if (denied === "duplicate-track") {
      throw new ConflictException("그 곡은 이미 대기열에 있어요");
    }

    console.log(
      `+ request: ${song.trackName} — ${song.artistName} (${song.requestedBy})`,
    );
    return { ok: true, song: publicSong(song, deviceId) };
  }

  @Post("/api/cancel")
  @RequestDto(CancelDto)
  async cancel(dto: CancelDto, context: RequestContext) {
    if (!dto.id) throw new BadRequestException("id가 필요해요");
    const removed = await this.queue.removeOwnedFromQueue(
      dto.id,
      deviceIdOf(context),
    );
    return { ok: removed };
  }
}

export async function lookupSong(search: SearchService, trackId: number) {
  try {
    return await search.lookup(trackId);
  } catch (error) {
    if (!(error instanceof SongLookupError)) throw error;
    if (error.code === "upstream-unavailable") {
      throw new HttpException(
        503,
        "곡 정보를 불러올 수 없어요. 다시 시도해주세요",
      );
    }
    throw new BadRequestException("재생할 수 있는 곡을 선택해주세요");
  }
}
