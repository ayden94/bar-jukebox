import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Post,
  type RequestContext,
  RequestDto,
} from "@fluojs/http";
import type { JukeboxDatabase, MusicSearch } from "../jukebox/providers";
import {
  JukeboxDatabaseToken,
  JukeboxStateToken,
  MusicSearchToken,
} from "../jukebox/providers";
import type { JukeboxStateStore } from "../jukebox/state";
import type { Song } from "../jukebox/types";
import { deviceIdOf } from "../middleware/device-cookie.middleware";
import {
  CancelDto,
  RequestSongDto,
  SearchQueryDto,
  type SongInputDto,
  TableQueryDto,
} from "./dto";

function makeSong(
  input: RequestSongDto | SongInputDto,
  requestedBy: string,
  deviceId: string | null,
  isStaff: boolean,
): Song {
  return {
    id: crypto.randomUUID(),
    trackId: input.trackId,
    trackName: input.trackName,
    artistName: input.artistName,
    artworkUrl: input.artworkUrl,
    albumUrl: input.albumUrl,
    trackNumber: input.trackNumber,
    durationSec: input.durationSec ?? null,
    requestedBy,
    deviceId,
    isStaff,
    requestedAt: Date.now(),
  };
}

@Inject(MusicSearchToken, JukeboxStateToken, JukeboxDatabaseToken)
@Controller()
export class JukeboxController {
  constructor(
    private readonly search: MusicSearch,
    private readonly state: JukeboxStateStore,
    private readonly db: JukeboxDatabase,
  ) {}

  @Get("/api/state")
  snapshot() {
    return this.state.snapshot();
  }

  @Get("/api/table")
  @RequestDto(TableQueryDto)
  table(dto: TableQueryDto, context: RequestContext) {
    const table = this.db.getTable(Number(dto.t));
    if (!table || table.secret !== dto.k) {
      throw new ForbiddenException("QR 코드를 확인할 수 없어요");
    }
    return {
      tableId: table.id,
      label: table.label,
      requestsPaused: this.state.isRequestsPaused(),
      notice: this.state.getNotice(),
      deviceId: deviceIdOf(context),
    };
  }

  @Get("/api/search")
  @RequestDto(SearchQueryDto)
  async searchSongs(dto: SearchQueryDto) {
    const q = dto.q?.trim();
    if (!q) throw new BadRequestException("검색어를 입력해주세요");
    try {
      const hits = await this.search.searchMusic(q);
      return { hits };
    } catch (e) {
      console.error("search error:", e);
      throw new InternalServerErrorException("검색 중 오류가 발생했어요");
    }
  }

  @Post("/api/request")
  @RequestDto(RequestSongDto)
  request(dto: RequestSongDto, context: RequestContext) {
    const table = this.db.getTable(dto.tableId);
    if (!table || table.secret !== dto.tableSecret) {
      throw new ForbiddenException("유효하지 않은 테이블이에요");
    }
    if (this.state.isRequestsPaused()) {
      throw new ForbiddenException("지금은 곡 신청을 받고 있지 않아요");
    }
    const deviceId = deviceIdOf(context);
    if (!deviceId) {
      throw new ForbiddenException(
        "기기를 확인할 수 없어요. 페이지를 새로고침해주세요",
      );
    }
    if (this.state.deviceHasActive(deviceId)) {
      throw new ConflictException(
        "이 기기에서 신청한 곡이 아직 대기 중이에요. 그 곡이 재생된 뒤에 또 신청할 수 있어요.",
      );
    }
    if (this.state.trackIsActive(dto.trackId)) {
      throw new ConflictException("그 곡은 이미 대기열에 있어요");
    }

    const song = makeSong(dto, table.label, deviceId, false);
    this.state.enqueue(song);
    console.log(
      `+ request: ${song.trackName} — ${song.artistName} (${song.requestedBy})`,
    );
    return { ok: true, song };
  }

  @Post("/api/cancel")
  @RequestDto(CancelDto)
  cancel(dto: CancelDto, context: RequestContext) {
    if (!dto.id) throw new BadRequestException("id가 필요해요");
    const removed = this.state.removeOwnedFromQueue(
      dto.id,
      deviceIdOf(context),
    );
    return { ok: removed };
  }
}
