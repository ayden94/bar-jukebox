import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Post,
  RequestDto,
  UseGuards,
} from "@fluojs/http";
import { AdminTokenGuard } from "../admin/admin-token.guard";
import { PlaybackService } from "../playback/playback.service";
import {
  BackgroundService,
  InvalidBackgroundSettingsError,
} from "./background.service";
import { BackgroundPlayer } from "./background-player";
import { BackgroundEmptyDto, BackgroundSettingsDto } from "./dto";

@Inject(BackgroundService, BackgroundPlayer, PlaybackService)
@UseGuards(AdminTokenGuard)
@Controller("/api/admin/background")
export class BackgroundController {
  constructor(
    private readonly settings: BackgroundService,
    private readonly player: BackgroundPlayer,
    private readonly playback: PlaybackService,
  ) {}

  @Get("/")
  @RequestDto(BackgroundEmptyDto)
  snapshot(_dto: BackgroundEmptyDto) {
    return { settings: this.settings.read(), status: this.player.status() };
  }

  @Get("/playlists")
  @RequestDto(BackgroundEmptyDto)
  async playlists(_dto: BackgroundEmptyDto) {
    const result = await this.player.listPlaylists(AbortSignal.timeout(15000));
    if (!result.ok) {
      throw new ConflictException(
        `재생 목록을 불러오지 못했어요 (${result.error.code}). 음악 앱 연결을 확인해주세요.`,
      );
    }
    return { playlists: result.value };
  }

  @Post("/settings")
  @RequestDto(BackgroundSettingsDto)
  async update(dto: BackgroundSettingsDto) {
    try {
      await this.settings.update({
        ...(dto.enabled === null ? {} : { enabled: dto.enabled }),
        ...(dto.playlist === null ? {} : { playlist: dto.playlist }),
        ...(dto.handoff === null ? {} : { handoff: dto.handoff }),
      });
    } catch (error) {
      if (error instanceof InvalidBackgroundSettingsError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { ok: true, settings: this.settings.read() };
  }

  @Post("/start")
  @RequestDto(BackgroundEmptyDto)
  async start(_dto: BackgroundEmptyDto) {
    await this.control(() => this.playback.startBackground());
    return { ok: true, status: this.player.status() };
  }

  @Post("/stop")
  @RequestDto(BackgroundEmptyDto)
  async stop(_dto: BackgroundEmptyDto) {
    await this.control(() => this.playback.stopBackground());
    return { ok: true, status: this.player.status() };
  }

  private async control(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      throw new ConflictException(
        error instanceof Error ? error.message : "배경 음악을 바꾸지 못했어요",
      );
    }
  }
}
