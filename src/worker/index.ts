import { getDb } from "../lib/db";
import { logger } from "../lib/logger";

export async function runWorkerIteration(): Promise<void> {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT id, job_type, payload
      FROM job_queue
      WHERE status = 'queued' AND available_at <= now()
      ORDER BY id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    if (!result.rowCount) {
      await client.query("COMMIT");
      return;
    }

    const job = result.rows[0];
    await client.query("UPDATE job_queue SET status='running', attempts=attempts+1, updated_at=now() WHERE id=$1", [job.id]);
    await client.query("COMMIT");

    logger.info({ jobId: job.id, jobType: job.job_type }, "worker claimed job");
    await db.query("UPDATE job_queue SET status='succeeded', updated_at=now() WHERE id=$1", [job.id]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error({ err: error }, "worker iteration failed");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const interval = Number(process.env.WORKER_POLL_MS ?? 2000);
  logger.info({ interval }, "ORBIT worker started");
  setInterval(() => void runWorkerIteration(), interval);
}
