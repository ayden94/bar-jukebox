import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  RequestDto,
  UseGuards,
} from "@fluojs/http";
import QRCode from "qrcode";
import { PlaybackService } from "../playback/playback.service";
import { CancelDto, ReorderDto, SongInputDto } from "../queue/dto";
import { QueueService } from "../queue/queue.service";
import { SettingsDto } from "../settings/dto";
import { SettingsService } from "../settings/settings.service";
import { BASE_URL } from "../shared/config";
import { makeSong } from "../shared/song";
import { TableIdDto, TableLabelDto } from "../table/dto";
import { TableService } from "../table/table.service";
import { AdminTokenGuard } from "./admin-token.guard";

@Inject(TableService, QueueService, SettingsService, PlaybackService)
@UseGuards(AdminTokenGuard)
@Controller("/api/admin")
export class AdminController {
  constructor(
    private readonly tableService: TableService,
    private readonly queue: QueueService,
    private readonly settingsService: SettingsService,
    private readonly playback: PlaybackService,
  ) {}

  @Post("/skip")
  async skip() {
    const current = this.queue.nowPlayingSong();
    await this.playback.stop().catch((e) => console.error("stop error:", e));
    if (current) this.queue.finishNowPlaying("failed");
    return { ok: true };
  }

  @Post("/remove")
  @RequestDto(CancelDto)
  remove(dto: CancelDto) {
    if (!dto?.id) throw new BadRequestException("id가 필요해요");
    const removed = this.queue.removeFromQueue(dto.id);
    return { ok: removed };
  }

  @Post("/add")
  @RequestDto(SongInputDto)
  add(dto: SongInputDto) {
    const song = makeSong(dto, "바텐더", null, true);
    this.queue.enqueue(song);
    console.log(`+ staff add: ${song.trackName} — ${song.artistName}`);
    return { ok: true, song };
  }

  @Post("/reorder")
  @RequestDto(ReorderDto)
  reorder(dto: ReorderDto) {
    if (!Array.isArray(dto?.ids)) {
      throw new BadRequestException("ids 배열이 필요해요");
    }
    this.queue.reorder(dto.ids);
    return { ok: true };
  }

  @Get("/tables")
  async tables() {
    const tables = (await this.tableService.list()).map((t) => ({
      id: t.id,
      label: t.label,
      url: this.tableService.qrUrl(t),
      createdAt: t.createdAt,
    }));
    return { tables, baseUrl: BASE_URL };
  }

  @Post("/tables")
  @RequestDto(TableLabelDto)
  async createTable(dto: TableLabelDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException("테이블 이름을 입력해주세요");
    if (label.length > 30) {
      throw new BadRequestException("테이블 이름은 30자 이내");
    }
    const table = await this.tableService.create(label);
    console.log(`+ table: ${table.label} (#${table.id})`);
    return {
      ok: true,
      table: {
        ...table,
        url: this.tableService.qrUrl(table),
      },
    };
  }

  @Delete("/tables/:id")
  @RequestDto(TableIdDto)
  async deleteTable(dto: TableIdDto) {
    const id = Number(dto.id);
    if (!Number.isInteger(id)) {
      throw new BadRequestException("잘못된 id예요");
    }
    const removed = await this.tableService.remove(id);
    return { ok: removed };
  }

  @Get("/tables/:id/qr")
  @RequestDto(TableIdDto)
  async qr(dto: TableIdDto) {
    const id = Number(dto.id);
    const table = Number.isInteger(id)
      ? await this.tableService.find(id)
      : null;
    if (!table) throw new BadRequestException("테이블을 찾을 수 없어요");
    const url = this.tableService.qrUrl(table);
    const svg = await QRCode.toString(url, {
      type: "svg",
      margin: 1,
      width: 240,
    });
    return { url, svg };
  }

  @Post("/settings")
  @RequestDto(SettingsDto)
  settings(dto: SettingsDto) {
    if (typeof dto?.requestsPaused === "boolean") {
      this.settingsService.setRequestsPaused(dto.requestsPaused);
    }
    if (typeof dto?.notice === "string") {
      if (dto.notice.length > 200) {
        throw new BadRequestException("공지는 200자 이내");
      }
      this.settingsService.setNotice(dto.notice);
    }
    return { ok: true };
  }
}
