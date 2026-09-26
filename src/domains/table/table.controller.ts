import { Inject } from "@fluojs/core";
import { Controller, ForbiddenException, Get, RequestDto } from "@fluojs/http";
import { SettingsService } from "../settings/settings.service";
import { TableQueryDto } from "./dto";
import { TableService } from "./table.service";

@Inject(TableService, SettingsService)
@Controller()
export class TableController {
  constructor(
    private readonly tableService: TableService,
    private readonly settings: SettingsService,
  ) {}

  @Get("/api/table")
  @RequestDto(TableQueryDto)
  async table(dto: TableQueryDto) {
    const table = await this.tableService.verify(Number(dto.t), dto.k);
    if (!table) {
      throw new ForbiddenException("QR 코드를 확인할 수 없어요");
    }
    return {
      tableId: table.id,
      label: table.label,
      requestsPaused: this.settings.isRequestsPaused(),
      notice: this.settings.getNotice(),
    };
  }
}
