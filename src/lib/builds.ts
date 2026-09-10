import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { GitHubClient } from "./github/client";
import { IntegrationError, idSchema } from "./github/security";

export const buildSettingsSchema = z.object({
  installationId: idSchema,
  repositoryId: idSchema,
  enabled: z.boolean(),
  eventBuilds: z.boolean(),
  scheduleIntervalMinutes: z.number().int().min(5).max(10080).nullable(),
}).strict();

export const manualBuildSchema = z.object({ installationId: idSchema, repositoryId: idSchema }).strict();

type Trigger = "manual" | "schedule" | "push";
type TriggerPayload = { repositoryId: number; installationId: number; triggerType: Trigger; triggerKey: string; requestedBy: string };

export async function saveBuildSettings(db: Pool, github: GitHubClient, input: z.infer<typeof buildSettingsSchema>, actor: string) {
  const repository = (await github.repositories(input.installationId)).find(item => item.id === input.repositoryId);
  if (!repository) throw new IntegrationError(403, "Repository is not authorized for this installation");
  const result = await db.query(`UPDATE github_repositories SET enabled=$3, event_builds=$4,
      schedule_interval_minutes=$5,
      next_scheduled_at=CASE WHEN $3 AND $5::integer IS NOT NULL THEN COALESCE(next_scheduled_at, now()+make_interval(mins => $5::integer)) ELSE NULL END,
      updated_at=now()
    WHERE repository_id=$1 AND installation_id=$2 AND access_status='active' RETURNING *`,
  [input.repositoryId, input.installationId, input.enabled, input.eventBuilds, input.scheduleIntervalMinutes]);
  if (!result.rowCount) throw new IntegrationError(404, "Repository configuration not found");
  await db.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,after_value)
    VALUES ($1,'build.settings_updated',$2,$3,$4)`, [actor, input.installationId, input.repositoryId, result.rows[0]]);
  return result.rows[0];
}

export async function queueManualBuild(db: Pool, github: GitHubClient, input: z.infer<typeof manualBuildSchema>, actor: string) {
  const repository = (await github.repositories(input.installationId)).find(item => item.id === input.repositoryId);
  if (!repository) throw new IntegrationError(403, "Repository is not authorized for this installation");
  const config = await db.query(`SELECT 1 FROM github_repositories WHERE repository_id=$1 AND installation_id=$2 AND enabled AND access_status='active'`, [input.repositoryId, input.installationId]);
  if (!config.rowCount) throw new IntegrationError(409, "Builds are disabled for this repository");
  const payload: TriggerPayload = { repositoryId: input.repositoryId, installationId: input.installationId, triggerType: "manual", triggerKey: `manual:${randomUUID()}`, requestedBy: actor };
  await db.query("INSERT INTO job_queue(job_type,payload) VALUES ('build.trigger',$1)", [payload]);
  return { queued: true, triggerKey: payload.triggerKey };
}

export async function listBuildRuns(db: Pool, installationId: number, repositoryIds: number[]) {
  if (!repositoryIds.length) return [];
  return (await db.query(`SELECT id,repository_id,installation_id,workflow_id,trigger_type,ref,commit_sha,github_run_id,status,requested_by,requested_at,started_at,completed_at
    FROM build_runs WHERE installation_id=$1 AND repository_id=ANY($2::bigint[]) ORDER BY requested_at DESC LIMIT 200`, [installationId, repositoryIds])).rows;
}

export async function enqueueDueSchedules(client: PoolClient) {
  const due = await client.query(`SELECT repository_id,installation_id,next_scheduled_at,schedule_interval_minutes
    FROM github_repositories WHERE enabled AND access_status='active' AND schedule_interval_minutes IS NOT NULL AND next_scheduled_at<=now()
    ORDER BY next_scheduled_at FOR UPDATE SKIP LOCKED LIMIT 20`);
  for (const row of due.rows) {
    const triggerKey = `schedule:${row.repository_id}:${new Date(row.next_scheduled_at).toISOString()}`;
    const payload: TriggerPayload = { repositoryId: Number(row.repository_id), installationId: Number(row.installation_id), triggerType: "schedule", triggerKey, requestedBy: "orbit.scheduler" };
    await client.query("INSERT INTO job_queue(job_type,payload) VALUES ('build.trigger',$1)", [payload]);
    await client.query(`UPDATE github_repositories SET next_scheduled_at=next_scheduled_at+make_interval(mins => schedule_interval_minutes), updated_at=now() WHERE repository_id=$1`, [row.repository_id]);
  }
}

export async function processBuildTrigger(client: PoolClient, github: GitHubClient, payload: TriggerPayload) {
  const configResult = await client.query(`SELECT * FROM github_repositories WHERE repository_id=$1 AND installation_id=$2 AND enabled AND access_status='active' FOR UPDATE`, [payload.repositoryId, payload.installationId]);
  const config = configResult.rows[0];
  if (!config) throw new IntegrationError(409, "Builds are disabled or repository access was revoked");
  const validated = await github.validate(payload.installationId, payload.repositoryId, config.default_ref, Number(config.workflow_id));
  const inserted = await client.query(`INSERT INTO build_runs(repository_id,installation_id,workflow_id,trigger_type,trigger_key,ref,commit_sha,requested_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (trigger_key) DO NOTHING RETURNING *`,
  [payload.repositoryId, payload.installationId, config.workflow_id, payload.triggerType, payload.triggerKey, config.default_ref, validated.refSha, payload.requestedBy]);
  if (!inserted.rowCount) return { duplicate: true };
  await github.dispatch(payload.installationId, payload.repositoryId, Number(config.workflow_id), config.default_ref);
  await client.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,after_value)
    VALUES ($1,'build.dispatched',$2,$3,$4)`, [payload.requestedBy, payload.installationId, payload.repositoryId, { buildRunId: inserted.rows[0].id, triggerType: payload.triggerType, commitSha: validated.refSha }]);
  return inserted.rows[0];
}

export async function queuePushBuild(client: PoolClient, installationId: number, repositoryId: number, deliveryId: string, ref: string | undefined) {
  const config = await client.query(`SELECT default_ref,event_builds,enabled,access_status FROM github_repositories WHERE repository_id=$1 AND installation_id=$2`, [repositoryId, installationId]);
  const row = config.rows[0];
  if (!row || !row.enabled || !row.event_builds || row.access_status !== "active") return;
  if (ref !== `refs/${row.default_ref}`) return;
  const payload: TriggerPayload = { repositoryId, installationId, triggerType: "push", triggerKey: `push:${deliveryId}`, requestedBy: "github.webhook" };
  await client.query("INSERT INTO job_queue(job_type,payload) VALUES ('build.trigger',$1)", [payload]);
}

export async function syncWorkflowRun(client: PoolClient, installationId: number, repositoryId: number, workflowRun: { id: number; workflow_id: number; head_sha: string; status: string; conclusion: string | null }) {
  const mapped = workflowRun.status === "completed"
    ? workflowRun.conclusion === "success" ? "succeeded" : workflowRun.conclusion === "cancelled" ? "canceled" : "failed"
    : workflowRun.status === "in_progress" ? "running" : "queued";
  const existing = await client.query("SELECT id FROM build_runs WHERE github_run_id=$1", [workflowRun.id]);
  let id = existing.rows[0]?.id;
  if (!id) {
    const candidate = await client.query(`SELECT id FROM build_runs WHERE repository_id=$1 AND installation_id=$2 AND workflow_id=$3 AND commit_sha=$4 AND github_run_id IS NULL
      ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`, [repositoryId, installationId, workflowRun.workflow_id, workflowRun.head_sha]);
    id = candidate.rows[0]?.id;
  }
  if (!id) return;
  await client.query(`UPDATE build_runs SET github_run_id=$2,status=$3,
      started_at=CASE WHEN $3='running' THEN COALESCE(started_at,now()) ELSE started_at END,
      completed_at=CASE WHEN $3 IN ('succeeded','failed','canceled') THEN COALESCE(completed_at,now()) ELSE completed_at END,
      updated_at=now() WHERE id=$1`, [id, workflowRun.id, mapped]);

  if (["succeeded", "failed", "canceled"].includes(mapped)) {
    await client.query(`UPDATE build_runs SET status=$5,
        completed_at=COALESCE(completed_at,now()),
        updated_at=now()
      WHERE repository_id=$1 AND installation_id=$2 AND workflow_id=$3 AND commit_sha=$4
        AND github_run_id IS NULL AND status IN ('queued','running')`,
    [repositoryId, installationId, workflowRun.workflow_id, workflowRun.head_sha, mapped]);
  }
}
