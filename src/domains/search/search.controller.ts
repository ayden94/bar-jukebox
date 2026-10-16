import { Inject } from "@fluojs/core";
import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  type RequestContext,
  RequestDto,
} from "@fluojs/http";
import { ArtworkQueryDto, SearchQueryDto } from "./dto";
import { SearchService } from "./search.service";

@Inject(SearchService)
@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("/api/artwork")
  @RequestDto(ArtworkQueryDto)
  async artwork(dto: ArtworkQueryDto, context: RequestContext) {
    if (!dto.providerId || !dto.artworkId)
      throw new BadRequestException("커버 식별자가 필요해요");
    const artwork = await this.searchService.fetchArtwork(dto);
    if (!artwork) throw new NotFoundException("커버를 가져올 수 없어요");
    context.response.setHeader("Content-Type", artwork.contentType);
    context.response.setHeader("Cache-Control", "public, max-age=86400");
    return artwork.body;
  }

  @Get("/api/search")
  @RequestDto(SearchQueryDto)
  async searchSongs(dto: SearchQueryDto) {
    const q = dto.q?.trim();
    if (!q) throw new BadRequestException("검색어를 입력해주세요");
    try {
      return await this.searchService.search(q, dto.cursor || null);
    } catch (e) {
      console.error("search error:", e);
      throw new InternalServerErrorException("검색 중 오류가 발생했어요");
    }
  }
}
