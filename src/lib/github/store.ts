import type { Pool, PoolClient } from "pg";
import type { GitHubClient } from "./client";
import type { Configuration } from "./security";

export async function transaction<T>(db: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function saveConfiguration(db: Pool, github: GitHubClient, input: Configuration, actor: string) {
  const { repository, workflow } = await github.validate(input.installationId, input.repositoryId, input.ref, input.workflowId);
  return transaction(db, async client => {
    // Serialize upserts, including the first insert, so audit before/after is accurate.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [input.repositoryId]);
    const old = await client.query("SELECT * FROM github_repositories WHERE repository_id=$1 FOR UPDATE", [input.repositoryId]);
    const saved = await client.query(`INSERT INTO github_repositories
      (repository_id, installation_id, full_name, default_ref, workflow_id, workflow_path, enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (repository_id) DO UPDATE SET installation_id=EXCLUDED.installation_id,
      full_name=EXCLUDED.full_name, default_ref=EXCLUDED.default_ref, workflow_id=EXCLUDED.workflow_id,
      workflow_path=EXCLUDED.workflow_path, enabled=EXCLUDED.enabled, access_status='active', updated_at=now()
      RETURNING *`, [input.repositoryId, input.installationId, repository.full_name, input.ref, workflow.id, workflow.path, input.enabled]);
    await client.query(`INSERT INTO github_audit (actor,action,installation_id,repository_id,before_value,after_value)
      VALUES ($1,'repository.configured',$2,$3,$4,$5)`, [actor, input.installationId, input.repositoryId, old.rows[0] ?? null, saved.rows[0]]);
    return saved.rows[0];
  });
}

export async function listConfigurations(db: Pool, installationId: number, authorizedIds: number[]) {
  return (await db.query(`SELECT * FROM github_repositories
    WHERE installation_id=$1 AND repository_id=ANY($2::bigint[]) ORDER BY full_name`, [installationId, authorizedIds])).rows;
}

export async function listAudit(db: Pool, installationId: number, authorizedIds: number[]) {
  return (await db.query(`SELECT * FROM github_audit WHERE installation_id=$1 AND
    (repository_id IS NULL OR repository_id=ANY($2::bigint[])) ORDER BY id DESC LIMIT 100`, [installationId, authorizedIds])).rows;
}
