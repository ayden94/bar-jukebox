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
import { lookupSong } from "../queue/queue.controller";
import { QueueService } from "../queue/queue.service";
import { SearchService } from "../search/search.service";
import { SettingsDto } from "../settings/dto";
import {
  InvalidSettingsError,
  SettingsService,
} from "../settings/settings.service";
import { BASE_URL } from "../shared/config";
import { makeSong } from "../shared/song";
import { publicSong } from "../shared/state-view";
import { TableIdDto, TableLabelDto } from "../table/dto";
import { TableService } from "../table/table.service";
import { AdminTokenGuard } from "./admin-token.guard";

@Inject(
  TableService,
  QueueService,
  SettingsService,
  PlaybackService,
  SearchService,
)
@UseGuards(AdminTokenGuard)
@Controller("/api/admin")
export class AdminController {
  constructor(
    private readonly tableService: TableService,
    private readonly queue: QueueService,
    private readonly settingsService: SettingsService,
    private readonly playback: PlaybackService,
    private readonly search: SearchService,
  ) {}

  @Post("/skip")
  async skip() {
    await this.playback.skip();
    return { ok: true };
  }

  @Post("/remove")
  @RequestDto(CancelDto)
  async remove(dto: CancelDto) {
    if (!dto?.id) throw new BadRequestException("id가 필요해요");
    const removed = await this.queue.removeFromQueue(dto.id);
    return { ok: removed };
  }

  @Post("/add")
  @RequestDto(SongInputDto)
  async add(dto: SongInputDto) {
    const song = makeSong(
      await lookupSong(this.search, dto.trackId),
      "바텐더",
      null,
      true,
      null,
    );
    await this.queue.enqueue(song);
    console.log(`+ staff add: ${song.trackName} — ${song.artistName}`);
    return { ok: true, song: publicSong(song, "") };
  }

  @Post("/reorder")
  @RequestDto(ReorderDto)
  async reorder(dto: ReorderDto) {
    if (
      !Array.isArray(dto?.ids) ||
      !dto.ids.every((id) => typeof id === "string")
    ) {
      throw new BadRequestException("ids 배열이 필요해요");
    }
    await this.queue.reorder(dto.ids);
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
  async settings(dto: SettingsDto) {
    try {
      await this.settingsService.update({
        ...(dto.requestsPaused === null
          ? {}
          : { requestsPaused: dto.requestsPaused }),
        ...(dto.notice === null ? {} : { notice: dto.notice }),
        ...(dto.maxPerDevice === null
          ? {}
          : { maxPerDevice: dto.maxPerDevice }),
        ...(dto.maxPerTable === null ? {} : { maxPerTable: dto.maxPerTable }),
      });
    } catch (error) {
      if (error instanceof InvalidSettingsError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { ok: true };
  }
}
