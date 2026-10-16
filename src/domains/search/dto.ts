import { FromQuery, Optional } from "@fluojs/http";
import { IsString } from "@fluojs/validation";

export class SearchQueryDto {
  @IsString()
  @FromQuery("q")
  q = "";
  @Optional()
  @IsString()
  @FromQuery("cursor")
  cursor: string | null = null;
}

export class ArtworkQueryDto {
  @IsString()
  @FromQuery("providerId")
  providerId = "";
  @IsString()
  @FromQuery("artworkId")
  artworkId = "";
}
