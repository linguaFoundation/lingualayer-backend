import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/lingualayer";

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Applies src/db/schema.sql. Every statement is `IF NOT EXISTS`-guarded, so this is safe to call on every startup. */
export async function runMigrations(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  await pool.query(schema);
}
