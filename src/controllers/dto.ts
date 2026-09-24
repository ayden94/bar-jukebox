import {
  FromBody,
  FromCookie,
  FromPath,
  FromQuery,
  Optional,
} from "@fluojs/http";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsString,
} from "@fluojs/validation";

export class TableQueryDto {
  @IsString() @FromQuery("t") t = "";
  @IsString() @FromQuery("k") k = "";
}

export class SearchQueryDto {
  @IsString() @FromQuery("q") q = "";
}

// 주의: DTO 상속 시 필드 메타데이터가 부모에도 묶이므로 상속 대신 평탄화한다.
export class SongInputDto {
  @IsInt() @FromBody("trackId") trackId = 0;
  @IsString() @FromBody("trackName") trackName = "";
  @IsString() @FromBody("artistName") artistName = "";
  @IsString() @FromBody("artworkUrl") artworkUrl = "";
  @IsString() @FromBody("albumUrl") albumUrl = "";
  @IsInt() @FromBody("trackNumber") trackNumber = 0;
  @Optional() @IsNumber() @FromBody("durationSec") durationSec: number | null =
    null;
}

export class RequestSongDto {
  @IsInt() @FromBody("trackId") trackId = 0;
  @IsString() @FromBody("trackName") trackName = "";
  @IsString() @FromBody("artistName") artistName = "";
  @IsString() @FromBody("artworkUrl") artworkUrl = "";
  @IsString() @FromBody("albumUrl") albumUrl = "";
  @IsInt() @FromBody("trackNumber") trackNumber = 0;
  @Optional() @IsNumber() @FromBody("durationSec") durationSec: number | null =
    null;
  @IsInt() @FromBody("tableId") tableId = 0;
  @IsString() @FromBody("tableSecret") tableSecret = "";
  @Optional() @IsString() @FromCookie("bj_did") cookieDeviceId = "";
}

export class CancelDto {
  @IsString() @FromBody("id") id = "";
}

export class TableLabelDto {
  @IsString() @FromBody("label") label = "";
}

export class TableIdDto {
  @IsString() @FromPath("id") id = "";
}

export class ReorderDto {
  @IsArray() @FromBody("ids") ids: string[] = [];
}

export class SettingsDto {
  @Optional() @IsBoolean() @FromBody("requestsPaused") requestsPaused:
    | boolean
    | null = null;
  @Optional() @IsString() @FromBody("notice") notice: string | null = null;
}
