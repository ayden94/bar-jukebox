import { FromBody, Optional } from "@fluojs/http";
import { IsBoolean, IsInt, IsString } from "@fluojs/validation";

export class SettingsDto {
  @Optional()
  @IsBoolean()
  @FromBody("requestsPaused")
  requestsPaused: boolean | null = null;
  @Optional()
  @IsString()
  @FromBody("notice")
  notice: string | null = null;
  @Optional()
  @IsInt()
  @FromBody("maxPerDevice")
  maxPerDevice: number | null = null;
  @Optional()
  @IsInt()
  @FromBody("maxPerTable")
  maxPerTable: number | null = null;
}
