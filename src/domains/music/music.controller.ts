import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Post,
  type RequestContext,
  RequestDto,
  UseGuards,
} from "@fluojs/http";
import type { MusicResult } from "../../music/contracts";
import { AdminTokenGuard } from "../admin/admin-token.guard";
import { MusicConfigDto, MusicTargetDto } from "./dto";
import { MusicConfigurationError, MusicService } from "./music.service";

class MusicDeveloperTokenDto {}

function requireResult<T>(result: MusicResult<T>): T {
  if (!result.ok) {
    throw new ConflictException(
      `음악 연결을 완료하지 못했어요 (${result.error.code}). 상태를 새로고침해주세요.`,
    );
  }
  return result.value;
}

@Inject(MusicService)
@UseGuards(AdminTokenGuard)
@Controller("/api/admin/music")
export class MusicController {
  constructor(private readonly music: MusicService) {}

  @Get("/")
  async snapshot() {
    return await this.music.getSnapshot();
  }

  @Get("/developer-token")
  @RequestDto(MusicDeveloperTokenDto)
  developerToken(_dto: MusicDeveloperTokenDto, context: RequestContext) {
    context.response.setHeader("Cache-Control", "no-store");
    const result = this.music.getDeveloperToken();
    if (!result.ok) {
      context.response.setStatus(
        result.error.code === "unsupported" ? 404 : 503,
      );
      return {
        error: result.error,
        readiness:
          result.error.code === "unsupported"
            ? "unavailable"
            : "setup-required",
        reason:
          result.error.code === "unsupported"
            ? "현재 선택한 재생 방식에서는 개발자 토큰을 제공하지 않아요."
            : "유효한 MUSICKIT_DEVELOPER_TOKEN을 설정하고 서버를 다시 시작해주세요.",
      };
    }
    return result.value;
  }

  @Post("/config")
  @RequestDto(MusicConfigDto)
  async configure(dto: MusicConfigDto) {
    try {
      return await this.music.saveConfig(dto);
    } catch (error) {
      if (error instanceof MusicConfigurationError) {
        if (error.code === "environment-locked") {
          throw new ConflictException(error.message);
        }
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("/auth/connect")
  async connectAuth() {
    requireResult(await this.music.connectAuth(new AbortController().signal));
    return await this.music.getSnapshot();
  }

  @Post("/auth/disconnect")
  async disconnectAuth() {
    requireResult(
      await this.music.disconnectAuth(new AbortController().signal),
    );
    return await this.music.getSnapshot();
  }

  @Get("/targets")
  async targets() {
    return {
      targets: requireResult(
        await this.music.listTargets(new AbortController().signal),
      ),
    };
  }

  @Post("/targets/connect")
  @RequestDto(MusicTargetDto)
  async connectTarget(dto: MusicTargetDto) {
    if (!dto.targetId) {
      throw new BadRequestException("재생 기기를 선택해주세요.");
    }
    requireResult(
      await this.music.connectTarget(dto, new AbortController().signal),
    );
    return await this.music.getSnapshot();
  }

  @Post("/targets/disconnect")
  async disconnectTarget() {
    requireResult(
      await this.music.disconnectTarget(new AbortController().signal),
    );
    return await this.music.getSnapshot();
  }
}
