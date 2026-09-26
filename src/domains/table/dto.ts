import {
  FromBody,
  FromCookie,
  FromPath,
  FromQuery,
  Optional,
} from "@fluojs/http";
import { IsString } from "@fluojs/validation";

export class GuestQueryDto {
  @Optional()
  @IsString()
  @FromQuery("t")
  t = "";
  @Optional()
  @IsString()
  @FromQuery("k")
  k = "";
  @Optional()
  @IsString()
  @FromCookie("bj_theme")
  theme = "";
}

export class TableQueryDto {
  @IsString()
  @FromQuery("t")
  t = "";
  @IsString()
  @FromQuery("k")
  k = "";
}

export class TableLabelDto {
  @IsString()
  @FromBody("label")
  label = "";
}

export class TableIdDto {
  @IsString()
  @FromPath("id")
  id = "";
}
