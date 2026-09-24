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

import { BASE_URL } from "../jukebox/config";
import type { JukeboxDatabase, Playback } from "../jukebox/providers";
import {
  JukeboxDatabaseToken,
  JukeboxStateToken,
  PlaybackToken,
} from "../jukebox/providers";
import type { JukeboxStateStore } from "../jukebox/state";
import { AdminTokenGuard } from "./admin-token.guard";
import {
  CancelDto,
  ReorderDto,
  SettingsDto,
  SongInputDto,
  TableIdDto,
  TableLabelDto,
} from "./dto";

@Inject(JukeboxDatabaseToken, JukeboxStateToken, PlaybackToken)
@UseGuards(AdminTokenGuard)
@Controller("/api/admin")
export class AdminController {
  constructor(
    private readonly db: JukeboxDatabase,
    private readonly state: JukeboxStateStore,
    private readonly playback: Playback,
  ) {}

  @Post("/skip")
  async skip() {
    const current = this.state.nowPlayingSong();
    await this.playback
      .stopPlayback()
      .catch((e) => console.error("stop error:", e));
    if (current) this.state.finishNowPlaying("failed");
    return { ok: true };
  }

  @Post("/remove")
  @RequestDto(CancelDto)
  remove(dto: CancelDto) {
    if (!dto?.id) throw new BadRequestException("id가 필요해요");
    const removed = this.state.removeFromQueue(dto.id);
    return { ok: removed };
  }

  @Post("/add")
  @RequestDto(SongInputDto)
  add(dto: SongInputDto) {
    const song = {
      id: crypto.randomUUID(),
      trackId: dto.trackId,
      trackName: dto.trackName,
      artistName: dto.artistName,
      artworkUrl: dto.artworkUrl,
      albumUrl: dto.albumUrl,
      trackNumber: dto.trackNumber,
      durationSec: dto.durationSec ?? null,
      requestedBy: "바텐더",
      deviceId: null,
      isStaff: true,
      requestedAt: Date.now(),
    };
    this.state.enqueue(song);
    console.log(`+ staff add: ${song.trackName} — ${song.artistName}`);
    return { ok: true, song };
  }

  @Post("/reorder")
  @RequestDto(ReorderDto)
  reorder(dto: ReorderDto) {
    if (!Array.isArray(dto?.ids))
      throw new BadRequestException("ids 배열이 필요해요");
    this.state.reorder(dto.ids);
    return { ok: true };
  }

  @Get("/tables")
  tables() {
    const tables = this.db.listTables().map((t) => ({
      id: t.id,
      label: t.label,
      url: `${BASE_URL}/?t=${t.id}&k=${t.secret}`,
      createdAt: t.createdAt,
    }));
    return { tables, baseUrl: BASE_URL };
  }

  @Post("/tables")
  @RequestDto(TableLabelDto)
  createTable(dto: TableLabelDto) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException("테이블 이름을 입력해주세요");
    if (label.length > 30)
      throw new BadRequestException("테이블 이름은 30자 이내");
    const secret = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const table = this.db.createTable(label, secret);
    console.log(`+ table: ${table.label} (#${table.id})`);
    return {
      ok: true,
      table: { ...table, url: `${BASE_URL}/?t=${table.id}&k=${table.secret}` },
    };
  }

  @Delete("/tables/:id")
  @RequestDto(TableIdDto)
  deleteTable(dto: TableIdDto) {
    const id = Number(dto.id);
    if (!Number.isInteger(id)) throw new BadRequestException("잘못된 id예요");
    const removed = this.db.deleteTable(id);
    return { ok: removed };
  }

  @Get("/tables/:id/qr")
  @RequestDto(TableIdDto)
  async qr(dto: TableIdDto) {
    const id = Number(dto.id);
    const table = Number.isInteger(id) ? this.db.getTable(id) : null;
    if (!table) throw new BadRequestException("테이블을 찾을 수 없어요");
    const url = `${BASE_URL}/?t=${table.id}&k=${table.secret}`;
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
      this.state.setRequestsPaused(dto.requestsPaused);
    }
    if (typeof dto?.notice === "string") {
      if (dto.notice.length > 200)
        throw new BadRequestException("공지는 200자 이내");
      this.state.setNotice(dto.notice);
    }
    return { ok: true };
  }
}
