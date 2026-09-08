import { z } from "zod";
import type { Pool } from "pg";
import { getLevel1Assessment, type Level1State } from "./static-analysis";

export type ConfidenceState = "not-configured" | "pending" | "running" | "passed" | "failed" | "blocked" | "stale";

type Requirement = { key: string; required: boolean; maxAgeMinutes: number | null };
type Observation = { key: string; state: "pending" | "running" | "passed" | "failed"; observedAt: Date; evidenceId: number | null };

export const confidenceRequirementSchema = z.object({
  repositoryId: z.coerce.number().int().positive(),
  level: z.union([z.literal(2), z.literal(3)]),
  key: z.string().min(1).max(128),
  required: z.boolean().default(true),
  enabled: z.boolean().default(true),
  maxAgeMinutes: z.coerce.number().int().positive().optional(),
}).strict();

export const confidenceEvidenceSchema = z.object({
  artifactId: z.coerce.number().int().positive(),
  level: z.union([z.literal(2), z.literal(3)]),
  key: z.string().min(1).max(128),
  state: z.enum(["pending", "running", "passed", "failed"]),
  evidenceId: z.coerce.number().int().positive().optional(),
  observedAt: z.coerce.date(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
}).strict();

export function evaluateConfiguredLevel(requirements: Requirement[], observations: Observation[], lowerLevelPassed: boolean, now = new Date()): ConfidenceState {
  const required = requirements.filter((item) => item.required);
  if (!required.length) return "not-configured";
  if (!lowerLevelPassed) return "blocked";

  const byKey = new Map(observations.map((item) => [item.key, item]));
  for (const requirement of required) {
    const observation = byKey.get(requirement.key);
    if (!observation) return "pending";
    if (observation.state === "failed") return "failed";
    if (observation.state === "running") return "running";
    if (observation.state === "pending") return "pending";
    if (requirement.maxAgeMinutes != null) {
      const ageMs = now.getTime() - observation.observedAt.getTime();
      if (ageMs > requirement.maxAgeMinutes * 60_000) return "stale";
    }
  }
  return "passed";
}

function normalizeLevel1(state: Level1State): ConfidenceState {
  return state;
}

export function determineConfidenceLevel(level1: ConfidenceState, level2: ConfidenceState, level3: ConfidenceState) {
  if (level1 !== "passed") return 0;
  if (level2 !== "passed") return 1;
  if (level3 !== "passed") return 2;
  return 3;
}

export async function configureConfidenceRequirement(db: Pool, raw: unknown) {
  const input = confidenceRequirementSchema.parse(raw);
  return (await db.query(
    `INSERT INTO confidence_requirements(repository_id,level,key,required,enabled,max_age_minutes)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(repository_id,level,key) DO UPDATE
       SET required=EXCLUDED.required, enabled=EXCLUDED.enabled, max_age_minutes=EXCLUDED.max_age_minutes, updated_at=now()
     RETURNING *`,
    [input.repositoryId, input.level, input.key, input.required, input.enabled, input.maxAgeMinutes ?? null],
  )).rows[0];
}

export async function recordConfidenceEvidence(db: Pool, raw: unknown) {
  const input = confidenceEvidenceSchema.parse(raw);
  const artifact = await db.query("SELECT id,build_run_id,repository_id FROM artifacts WHERE id=$1", [input.artifactId]);
  if (!artifact.rowCount) throw new Error("Artifact does not exist");
  const item = artifact.rows[0];

  if (input.evidenceId) {
    const evidence = await db.query("SELECT id,artifact_id,build_run_id FROM evidence WHERE id=$1", [input.evidenceId]);
    if (!evidence.rowCount) throw new Error("Evidence does not exist");
    const source = evidence.rows[0];
    if (Number(source.build_run_id) !== Number(item.build_run_id)) throw new Error("Evidence does not belong to artifact BuildRun");
    if (source.artifact_id != null && Number(source.artifact_id) !== input.artifactId) throw new Error("Evidence belongs to a different artifact");
  }

  await db.query(
    `INSERT INTO confidence_evidence_state(artifact_id,build_run_id,repository_id,level,key,state,evidence_id,observed_at,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(artifact_id,level,key) DO UPDATE
       SET state=EXCLUDED.state, evidence_id=EXCLUDED.evidence_id, observed_at=EXCLUDED.observed_at,
           metadata=EXCLUDED.metadata, updated_at=now()`,
    [input.artifactId, item.build_run_id, item.repository_id, input.level, input.key, input.state, input.evidenceId ?? null, input.observedAt, input.metadata],
  );
  return recalculateConfidence(db, input.artifactId);
}

async function loadConfiguredLevel(db: Pool, artifactId: number, repositoryId: number, level: 2 | 3) {
  const requirementsResult = await db.query(
    "SELECT key,required,max_age_minutes FROM confidence_requirements WHERE repository_id=$1 AND level=$2 AND enabled=true ORDER BY key",
    [repositoryId, level],
  );
  const observationsResult = await db.query(
    "SELECT key,state,observed_at,evidence_id FROM confidence_evidence_state WHERE artifact_id=$1 AND level=$2 ORDER BY key",
    [artifactId, level],
  );
  return {
    requirements: requirementsResult.rows.map((row) => ({ key: String(row.key), required: Boolean(row.required), maxAgeMinutes: row.max_age_minutes == null ? null : Number(row.max_age_minutes) })),
    observations: observationsResult.rows.map((row) => ({ key: String(row.key), state: row.state as Observation["state"], observedAt: new Date(row.observed_at), evidenceId: row.evidence_id == null ? null : Number(row.evidence_id) })),
  };
}

export async function recalculateConfidence(db: Pool, artifactId: number, now = new Date()) {
  const artifactResult = await db.query(
    "SELECT id,build_run_id,repository_id,commit_sha FROM artifacts WHERE id=$1",
    [artifactId],
  );
  if (!artifactResult.rowCount) throw new Error("Artifact does not exist");
  const artifact = artifactResult.rows[0];
  const level1Assessment = await getLevel1Assessment(db, Number(artifact.build_run_id));
  if (level1Assessment.commitSha !== artifact.commit_sha) throw new Error("Artifact lineage does not match Level 1 BuildRun");

  const level1 = normalizeLevel1(level1Assessment.status);
  const level2Data = await loadConfiguredLevel(db, artifactId, Number(artifact.repository_id), 2);
  const level2 = evaluateConfiguredLevel(level2Data.requirements, level2Data.observations, level1 === "passed", now);
  const level3Data = await loadConfiguredLevel(db, artifactId, Number(artifact.repository_id), 3);
  const level3 = evaluateConfiguredLevel(level3Data.requirements, level3Data.observations, level1 === "passed" && level2 === "passed", now);
  const confidenceLevel = determineConfidenceLevel(level1, level2, level3);

  const snapshot = {
    artifactId,
    buildRunId: Number(artifact.build_run_id),
    repositoryId: Number(artifact.repository_id),
    commitSha: artifact.commit_sha,
    deterministic: true,
    levels: {
      1: { state: level1, assessment: level1Assessment },
      2: { state: level2, ...level2Data },
      3: { state: level3, ...level3Data },
    },
  };

  const previous = await db.query("SELECT confidence_level,level_1_state,level_2_state,level_3_state FROM confidence_current WHERE artifact_id=$1", [artifactId]);
  const previousRow = previous.rows[0];
  const changed = !previous.rowCount || Number(previousRow.confidence_level) !== confidenceLevel || previousRow.level_1_state !== level1 || previousRow.level_2_state !== level2 || previousRow.level_3_state !== level3;

  if (changed) {
    await db.query(
      `INSERT INTO confidence_transitions(artifact_id,build_run_id,from_level,to_level,from_states,to_states,snapshot,source)
       VALUES($1,$2,$3,$4,$5,$6,$7,'deterministic-engine')`,
      [artifactId, artifact.build_run_id, previous.rowCount ? Number(previousRow.confidence_level) : null, confidenceLevel,
       previous.rowCount ? { level1: previousRow.level_1_state, level2: previousRow.level_2_state, level3: previousRow.level_3_state } : null,
       { level1, level2, level3 }, snapshot],
    );
  }

  return (await db.query(
    `INSERT INTO confidence_current(artifact_id,build_run_id,repository_id,commit_sha,confidence_level,level_1_state,level_2_state,level_3_state,snapshot,source,calculated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'deterministic-engine',$10)
     ON CONFLICT(artifact_id) DO UPDATE SET
       build_run_id=EXCLUDED.build_run_id, repository_id=EXCLUDED.repository_id, commit_sha=EXCLUDED.commit_sha,
       confidence_level=EXCLUDED.confidence_level, level_1_state=EXCLUDED.level_1_state,
       level_2_state=EXCLUDED.level_2_state, level_3_state=EXCLUDED.level_3_state,
       snapshot=EXCLUDED.snapshot, source='deterministic-engine', calculated_at=EXCLUDED.calculated_at
     RETURNING *`,
    [artifactId, artifact.build_run_id, artifact.repository_id, artifact.commit_sha, confidenceLevel, level1, level2, level3, snapshot, now],
  )).rows[0];
}

export async function getConfidenceHistory(db: Pool, artifactId: number) {
  return (await db.query("SELECT * FROM confidence_transitions WHERE artifact_id=$1 ORDER BY created_at,id", [artifactId])).rows;
}
