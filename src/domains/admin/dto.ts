import { FromCookie, Optional } from "@fluojs/http";
import { IsString } from "@fluojs/validation";

export class AdminPageDto {
  @Optional()
  @IsString()
  @FromCookie("bj_theme")
  theme = "";
}
