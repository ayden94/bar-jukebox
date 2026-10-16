import { FromQuery, Optional } from "@fluojs/http";
import { IsString } from "@fluojs/validation";

export class SearchQueryDto {
  @IsString()
  @FromQuery("q")
  q = "";
  @Optional()
  @IsString()
  @FromQuery("cursor")
  cursor = "";
}

export class ArtworkQueryDto {
  @IsString()
  @FromQuery("providerId")
  providerId = "";
  @IsString()
  @FromQuery("artworkId")
  artworkId = "";
}
