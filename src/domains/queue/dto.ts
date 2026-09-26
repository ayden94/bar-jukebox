import { FromBody, FromCookie, Optional } from "@fluojs/http";
import { IsArray, IsInt, IsString } from "@fluojs/validation";

// 주의: DTO 상속 시 필드 메타데이터가 부모에도 묶이므로 상속 대신 평탄화한다.
export class SongInputDto {
  @IsInt()
  @FromBody("trackId")
  trackId = 0;
}

export class RequestSongDto {
  @IsInt()
  @FromBody("trackId")
  trackId = 0;
  @IsInt()
  @FromBody("tableId")
  tableId = 0;
  @IsString()
  @FromBody("tableSecret")
  tableSecret = "";
  @Optional()
  @IsString()
  @FromCookie("bj_did")
  cookieDeviceId = "";
}

export class CancelDto {
  @IsString()
  @FromBody("id")
  id = "";
}

export class ReorderDto {
  @IsArray()
  @FromBody("ids")
  ids: string[] = [];
}
