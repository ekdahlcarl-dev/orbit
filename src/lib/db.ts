import { Pool } from "pg";
import { getServerConfig } from "./config";

let pool: Pool | undefined;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getServerConfig().DATABASE_URL, max: 10 });
  }
  return pool;
}

export async function databaseHealth(): Promise<boolean> {
  const result = await getDb().query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
