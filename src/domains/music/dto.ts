import { FromBody } from "@fluojs/http";
import { IsString } from "@fluojs/validation";

export class MusicConfigDto {
  @IsString()
  @FromBody("providerId")
  providerId = "";

  @IsString()
  @FromBody("modeId")
  modeId = "";
}

export class MusicTargetDto {
  @IsString()
  @FromBody("providerId")
  providerId = "";

  @IsString()
  @FromBody("modeId")
  modeId = "";

  @IsString()
  @FromBody("targetId")
  targetId = "";
}
