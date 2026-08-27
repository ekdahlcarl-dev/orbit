import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const dir = path.resolve("db/migrations");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (existing.rowCount) continue;

    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(JSON.stringify({ level: "info", event: "migration.applied", version: file }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
