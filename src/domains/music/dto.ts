import { FromBody } from "@fluojs/http";
import { IsInt, IsObject, IsString } from "@fluojs/validation";

export class MusicCatalogResultDto {
  @IsString()
  @FromBody("requestId")
  requestId = "";
  @IsInt()
  @FromBody("ownerEpoch")
  ownerEpoch = 0;
  @IsString()
  @FromBody("executorSessionId")
  executorSessionId = "";
  @IsString()
  @FromBody("connectionGeneration")
  connectionGeneration = "";
  @IsObject()
  @FromBody("target")
  target: unknown = null;
  @IsObject()
  @FromBody("result")
  result: unknown = null;
}

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
