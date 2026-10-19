import { FromBody, Optional } from "@fluojs/http";
import { IsBoolean, IsIn, IsString } from "@fluojs/validation";

export class BackgroundSettingsDto {
  @Optional()
  @IsBoolean()
  @FromBody("enabled")
  enabled: boolean | null = null;
  @Optional()
  @IsString()
  @FromBody("playlist")
  playlist: string | null = null;
  @Optional()
  @IsIn(["after-track", "immediate"])
  @FromBody("handoff")
  handoff: "after-track" | "immediate" | null = null;
}

export class BackgroundEmptyDto {}
