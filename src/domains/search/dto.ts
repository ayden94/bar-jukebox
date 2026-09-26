import { FromQuery } from "@fluojs/http";
import { IsString } from "@fluojs/validation";

export class SearchQueryDto {
  @IsString()
  @FromQuery("q")
  q = "";
}

export class ArtworkQueryDto {
  @IsString()
  @FromQuery("u")
  u = "";
}
