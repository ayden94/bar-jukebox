import { asc, eq } from "drizzle-orm";
import type { Drizzle } from "../../infra/db";
import { tables } from "../../infra/schema";

export type TableRow = {
  id: number;
  label: string;
  secret: string;
  createdAt: number;
};

export class TableRepository {
  constructor(private readonly db: Drizzle) {}

  async list(): Promise<TableRow[]> {
    const rows = await this.db.select().from(tables).orderBy(asc(tables.id));
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      secret: row.secret,
      createdAt: row.createdAt,
    }));
  }

  async find(id: number): Promise<TableRow | null> {
    const rows = await this.db
      .select()
      .from(tables)
      .where(eq(tables.id, id))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          id: row.id,
          label: row.label,
          secret: row.secret,
          createdAt: row.createdAt,
        }
      : null;
  }

  async create(label: string, secret: string): Promise<TableRow> {
    const inserted = await this.db
      .insert(tables)
      .values({ label, secret, createdAt: Date.now() })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("table insert returned no row");
    return {
      id: row.id,
      label: row.label,
      secret: row.secret,
      createdAt: row.createdAt,
    };
  }

  async remove(id: number): Promise<boolean> {
    const deleted = await this.db
      .delete(tables)
      .where(eq(tables.id, id))
      .returning({ id: tables.id });
    return deleted.length > 0;
  }
}
