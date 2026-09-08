import { z } from "zod";
import type { Pool } from "pg";
import { configureConfidenceRequirement, recordConfidenceEvidence } from "./confidence";

const metadataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const systemProviderSchema = z.object({
  repositoryId: z.coerce.number().int().positive(),
  providerKey: z.string().min(1).max(128),
  adapterKey: z.string().min(1).max(128),
  enabled: z.boolean().default(true),
  config: metadataSchema.default({}),
}).strict();

export const systemEnvironmentSchema = z.object({
  repositoryId: z.coerce.number().int().positive(),
  providerKey: z.string().min(1).max(128),
  environmentKey: z.string().min(1).max(128),
  environmentType: z.enum(["virtual", "hardware"]),
  enabled: z.boolean().default(true),
  configuration: metadataSchema.default({}),
}).strict();

export const systemRequirementSchema = z.object({
  repositoryId: z.coerce.number().int().positive(),
  providerKey: z.string().min(1).max(128),
  environmentKey: z.string().min(1).max(128),
  suiteKey: z.string().min(1).max(128),
  required: z.boolean().default(true),
  enabled: z.boolean().default(true),
  maxAgeMinutes: z.coerce.number().int().positive().optional(),
}).strict();

export const systemRunSchema = z.object({
  artifactId: z.coerce.number().int().positive(),
  providerKey: z.string().min(1).max(128),
  environmentKey: z.string().min(1).max(128),
  suiteKey: z.string().min(1).max(128),
  providerRunId: z.string().min(1).max(256),
  attempt: z.coerce.number().int().positive().default(1),
  state: z.enum(["queued", "running", "passed", "failed", "timed_out", "canceled", "incomplete"]),
  evidenceId: z.coerce.number().int().positive().optional(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  observedAt: z.coerce.date(),
  metadata: metadataSchema.default({}),
}).strict();

export interface SystemTestAdapter {
  key: string;
  trigger(input: { artifactDigest: string; environmentKey: string; suiteKey: string }): Promise<{ providerRunId: string }>;
  observe(providerRunId: string): Promise<{ state: z.infer<typeof systemRunSchema>["state"]; metadata?: Record<string, string | number | boolean | null> }>;
}

export function systemConfidenceKey(providerKey: string, environmentKey: string, suiteKey: string) {
  return `system:${providerKey}:environment:${environmentKey}:suite:${suiteKey}`;
}

export function toSystemConfidenceState(state: z.infer<typeof systemRunSchema>["state"]) {
  if (state === "queued") return "pending" as const;
  if (state === "running") return "running" as const;
  if (state === "passed") return "passed" as const;
  return "failed" as const;
}

export async function registerSystemProvider(db: Pool, raw: unknown) {
  const input = systemProviderSchema.parse(raw);
  return (await db.query(
    `INSERT INTO system_test_providers(repository_id,provider_key,adapter_key,enabled,config)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(repository_id,provider_key) DO UPDATE SET adapter_key=EXCLUDED.adapter_key,enabled=EXCLUDED.enabled,config=EXCLUDED.config,updated_at=now()
     RETURNING *`,
    [input.repositoryId,input.providerKey,input.adapterKey,input.enabled,input.config],
  )).rows[0];
}

export async function registerSystemEnvironment(db: Pool, raw: unknown) {
  const input = systemEnvironmentSchema.parse(raw);
  const provider = await db.query("SELECT id FROM system_test_providers WHERE repository_id=$1 AND provider_key=$2", [input.repositoryId,input.providerKey]);
  if (!provider.rowCount) throw new Error("System test provider does not exist");
  return (await db.query(
    `INSERT INTO system_test_environments(provider_id,environment_key,environment_type,configuration,enabled)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(provider_id,environment_key) DO UPDATE SET environment_type=EXCLUDED.environment_type,configuration=EXCLUDED.configuration,enabled=EXCLUDED.enabled,updated_at=now()
     RETURNING *`,
    [provider.rows[0].id,input.environmentKey,input.environmentType,input.configuration,input.enabled],
  )).rows[0];
}

export async function configureSystemSuite(db: Pool, raw: unknown) {
  const input = systemRequirementSchema.parse(raw);
  const row = (await db.query(
    `INSERT INTO system_test_requirements(repository_id,provider_key,environment_key,suite_key,required,enabled,max_age_minutes)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(repository_id,provider_key,environment_key,suite_key) DO UPDATE SET required=EXCLUDED.required,enabled=EXCLUDED.enabled,max_age_minutes=EXCLUDED.max_age_minutes,updated_at=now()
     RETURNING *`,
    [input.repositoryId,input.providerKey,input.environmentKey,input.suiteKey,input.required,input.enabled,input.maxAgeMinutes ?? null],
  )).rows[0];
  await configureConfidenceRequirement(db, { repositoryId: input.repositoryId, level: 3, key: systemConfidenceKey(input.providerKey,input.environmentKey,input.suiteKey), required: input.required, enabled: input.enabled, maxAgeMinutes: input.maxAgeMinutes });
  return row;
}

export async function recordSystemTestRun(db: Pool, raw: unknown) {
  const input = systemRunSchema.parse(raw);
  const artifactResult = await db.query("SELECT id,build_run_id,repository_id,commit_sha,digest FROM artifacts WHERE id=$1", [input.artifactId]);
  if (!artifactResult.rowCount) throw new Error("Artifact does not exist");
  const artifact = artifactResult.rows[0];
  const providerResult = await db.query("SELECT id,enabled FROM system_test_providers WHERE repository_id=$1 AND provider_key=$2", [artifact.repository_id,input.providerKey]);
  if (!providerResult.rowCount || !providerResult.rows[0].enabled) throw new Error("System test provider is unavailable");
  const environmentResult = await db.query("SELECT id,environment_type,enabled FROM system_test_environments WHERE provider_id=$1 AND environment_key=$2", [providerResult.rows[0].id,input.environmentKey]);
  if (!environmentResult.rowCount || !environmentResult.rows[0].enabled) throw new Error("System test environment is unavailable");

  if (input.evidenceId) {
    const evidenceResult = await db.query("SELECT id,artifact_id,build_run_id,evidence_type FROM evidence WHERE id=$1", [input.evidenceId]);
    if (!evidenceResult.rowCount) throw new Error("Evidence does not exist");
    const evidence = evidenceResult.rows[0];
    if (evidence.evidence_type !== "test") throw new Error("System test source evidence must have evidence_type=test");
    if (Number(evidence.build_run_id) !== Number(artifact.build_run_id) || evidence.artifact_id == null || Number(evidence.artifact_id) !== input.artifactId) throw new Error("System test evidence must reference the exact artifact");
  }

  const result = (await db.query(
    `INSERT INTO system_test_runs(artifact_id,build_run_id,repository_id,commit_sha,artifact_digest,provider_id,environment_id,suite_key,provider_run_id,attempt,state,evidence_id,started_at,completed_at,observed_at,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT(provider_id,provider_run_id,attempt) DO UPDATE SET state=EXCLUDED.state,evidence_id=EXCLUDED.evidence_id,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,observed_at=EXCLUDED.observed_at,metadata=EXCLUDED.metadata,updated_at=now()
     RETURNING *`,
    [input.artifactId,artifact.build_run_id,artifact.repository_id,artifact.commit_sha,artifact.digest,providerResult.rows[0].id,environmentResult.rows[0].id,input.suiteKey,input.providerRunId,input.attempt,input.state,input.evidenceId ?? null,input.startedAt ?? null,input.completedAt ?? null,input.observedAt,input.metadata],
  )).rows[0];

  const confidence = await recordConfidenceEvidence(db, {
    artifactId: input.artifactId,
    level: 3,
    key: systemConfidenceKey(input.providerKey,input.environmentKey,input.suiteKey),
    state: toSystemConfidenceState(input.state),
    evidenceId: input.evidenceId,
    observedAt: input.observedAt,
    metadata: { providerKey: input.providerKey, environmentKey: input.environmentKey, suiteKey: input.suiteKey, providerRunId: input.providerRunId, attempt: input.attempt, environmentType: String(environmentResult.rows[0].environment_type), terminal: !["queued","running"].includes(input.state) },
  });
  return { result, confidence };
}

export async function listSystemTestRuns(db: Pool, artifactId: number) {
  return (await db.query(
    `SELECT r.*,p.provider_key,p.adapter_key,e.environment_key,e.environment_type,e.configuration
     FROM system_test_runs r JOIN system_test_providers p ON p.id=r.provider_id JOIN system_test_environments e ON e.id=r.environment_id
     WHERE r.artifact_id=$1 ORDER BY r.observed_at DESC,r.id DESC`, [artifactId],
  )).rows;
}
