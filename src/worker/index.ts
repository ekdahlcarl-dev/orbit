import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import { processWebhook } from "../lib/github/webhooks";

export async function runWorkerIteration(db = getDb()): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT id, job_type, payload, attempts
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
    logger.info({ jobId: job.id, jobType: job.job_type }, "worker claimed job");
    await client.query("SAVEPOINT process_job");
    try {
      if (job.job_type === "github.webhook") {
        await processWebhook(client, job.payload.deliveryId);
        await client.query("UPDATE job_queue SET status='succeeded', updated_at=now() WHERE id=$1", [job.id]);
      } else {
        // Never report unimplemented work as successful.
        await client.query("UPDATE job_queue SET status='failed', updated_at=now() WHERE id=$1", [job.id]);
      }
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT process_job");
      await client.query(`UPDATE job_queue SET status=$2, available_at=now()+interval '30 seconds', updated_at=now()
        WHERE id=$1`, [job.id, job.attempts + 1 >= 3 ? "failed" : "queued"]);
      logger.warn({ jobId: job.id }, "worker job failed; bounded retry scheduled or exhausted");
    }
    await client.query("COMMIT");
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
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await runWorkerIteration(); } catch { /* Logged above; retry on next poll. */ }
    finally { running = false; }
  }, interval);
}
