import { BASE_URL } from "../shared/config";
import type { TableRepository, TableRow } from "./table.repository";

export class TableService {
  constructor(private readonly repository: TableRepository) {}

  qrUrl(table: TableRow): string {
    return `${BASE_URL}/?t=${table.id}&k=${table.secret}`;
  }

  verify(tableId: number, secret: string): Promise<TableRow | null> {
    return this.repository
      .find(tableId)
      .then((table) => (table && table.secret === secret ? table : null));
  }

  list(): Promise<TableRow[]> {
    return this.repository.list();
  }

  find(id: number): Promise<TableRow | null> {
    return this.repository.find(id);
  }

  create(label: string): Promise<TableRow> {
    const secret = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    return this.repository.create(label, secret);
  }

  remove(id: number): Promise<boolean> {
    return this.repository.remove(id);
  }
}
