import { FromBody, FromCookie, Optional } from "@fluojs/http";
import { IsBoolean, IsInt, IsString } from "@fluojs/validation";

export class ConfirmStoppedDto {
  @IsString()
  @FromBody("expectedSongId")
  expectedSongId = "";
  @IsBoolean()
  @FromBody("stoppedConfirmed")
  stoppedConfirmed = false;
  @Optional()
  @IsString()
  @FromBody("expectedAttemptId")
  expectedAttemptId: string | null = null;
  @IsInt()
  @FromBody("expectedOwnerEpoch")
  expectedOwnerEpoch = 0;
}

export class AdminPageDto {
  @Optional()
  @IsString()
  @FromCookie("bj_theme")
  theme = "";
}
