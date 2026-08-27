import type { EnvironmentInput } from "../config";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { idSchema, IntegrationError, readLimitedBody, requireInstallation, verifySignature } from "./security";
import { transaction } from "./store";

// Keep only normalized metadata required by ORB-3/4; discard arbitrary raw content.
const payloadSchema = z.object({
  action: z.string().max(100).optional(),
  installation: z.object({ id: idSchema }),
  repository: z.object({ id: idSchema }).optional(),
  repositories_removed: z.array(z.object({ id: idSchema })).optional(),
  workflow_run: z.object({ id: idSchema, workflow_id: idSchema, head_sha: z.string(), status: z.string(), conclusion: z.string().nullable(), run_attempt: z.number().optional() }).optional(),
  ref: z.string().max(1024).optional(),
  after: z.string().max(64).optional(),
});

export async function receiveWebhook(db: Pool, request: Request, env: EnvironmentInput = process.env) {
  const body = await readLimitedBody(request, 1024 * 1024);
  verifySignature(body, request.headers.get("x-hub-signature-256"), env);
  const deliveryId = request.headers.get("x-github-delivery");
  if (!deliveryId || !/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId)) throw new IntegrationError(400, "Invalid delivery ID");
  const event = request.headers.get("x-github-event") ?? "";
  if (!["ping", "installation", "installation_repositories", "push", "workflow_run"].includes(event)) return { ignored: true };
  // App-level setup pings have no installation identity. Signature still required.
  if (event === "ping") return { ping: true };
  const data = payloadSchema.parse(JSON.parse(body.toString("utf8")));
  requireInstallation(data.installation.id, env);
  if (["push", "workflow_run"].includes(event) && !data.repository) throw new IntegrationError(400, "Repository identity required");
  return transaction(db, async client => {
    if (data.repository) {
      const authorized = await client.query(`SELECT 1 FROM github_repositories
        WHERE repository_id=$1 AND installation_id=$2 AND access_status='active'`, [data.repository.id, data.installation.id]);
      if (!authorized.rowCount) throw new IntegrationError(403, "Repository is not onboarded");
    }
    const inserted = await client.query(`INSERT INTO github_deliveries(delivery_id,event,installation_id,repository_id,payload)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING delivery_id`,
    [deliveryId, event, data.installation.id, data.repository?.id ?? null, data]);
    if (!inserted.rowCount) return { duplicate: true };
    await client.query("INSERT INTO job_queue(job_type,payload) VALUES ('github.webhook',$1)", [{ deliveryId }]);
    return { accepted: true };
  });
}

// Runs inside the worker's claim transaction; crash rolls back both processing and claim.
export async function processWebhook(client: PoolClient, deliveryId: string) {
  const result = await client.query("SELECT * FROM github_deliveries WHERE delivery_id=$1 FOR UPDATE", [deliveryId]);
  const delivery = result.rows[0];
  if (!delivery) throw new Error("Webhook delivery missing");
  if (delivery.processed_at) return;
  const data = payloadSchema.parse(delivery.payload);
  const revokeInstallation = delivery.event === "installation" && ["deleted", "suspend"].includes(data.action ?? "");
  const removed = delivery.event === "installation_repositories" ? data.repositories_removed?.map(r => r.id) ?? [] : [];
  if (revokeInstallation || removed.length) {
    const repos = await client.query(`SELECT * FROM github_repositories WHERE installation_id=$1
      AND ($2::boolean OR repository_id=ANY($3::bigint[])) FOR UPDATE`, [data.installation.id, revokeInstallation, removed]);
    for (const before of repos.rows) {
      const updated = await client.query(`UPDATE github_repositories SET enabled=false, access_status='revoked', updated_at=now()
        WHERE repository_id=$1 RETURNING *`, [before.repository_id]);
      await client.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,before_value,after_value)
        VALUES ('github.webhook','repository.access_revoked',$1,$2,$3,$4)`, [data.installation.id, before.repository_id, before, updated.rows[0]]);
    }
  }
  await client.query(`INSERT INTO github_audit(actor,action,installation_id,repository_id,after_value)
    VALUES ('github.webhook',$1,$2,$3,$4)`, [`webhook.${delivery.event}`, data.installation.id, data.repository?.id ?? null, { deliveryId, action: data.action }]);
  // ORB-4 consumes persisted push/workflow_run metadata; no build/confidence claims here.
  await client.query("UPDATE github_deliveries SET processed_at=now() WHERE delivery_id=$1", [deliveryId]);
}
