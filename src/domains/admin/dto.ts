import { FromBody, FromCookie, Optional } from "@fluojs/http";
import { IsBoolean, IsString } from "@fluojs/validation";

export class ConfirmStoppedDto {
  @IsString()
  @FromBody("expectedSongId")
  expectedSongId = "";
  @IsBoolean()
  @FromBody("stoppedConfirmed")
  stoppedConfirmed = false;
}

export class AdminPageDto {
  @Optional()
  @IsString()
  @FromCookie("bj_theme")
  theme = "";
}
