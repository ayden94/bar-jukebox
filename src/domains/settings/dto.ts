import { FromBody, Optional } from "@fluojs/http";
import { IsBoolean, IsString } from "@fluojs/validation";

export class SettingsDto {
  @Optional()
  @IsBoolean()
  @FromBody("requestsPaused")
  requestsPaused: boolean | null = null;
  @Optional()
  @IsString()
  @FromBody("notice")
  notice: string | null = null;
}
