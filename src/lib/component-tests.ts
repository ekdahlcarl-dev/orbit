import { z } from "zod";
import type { Pool } from "pg";
import { configureConfidenceRequirement, recordConfidenceEvidence } from "./confidence";

const testCaseSchema = z.object({
  name: z.string().min(1).max(512),
  status: z.enum(["passed", "failed", "error", "skipped"]),
  durationMs: z.number().nonnegative().optional(),
  flaky: z.boolean().default(false),
}).strict();

const coverageSchema = z.object({
  linesPct: z.number().min(0).max(100).optional(),
  branchesPct: z.number().min(0).max(100).optional(),
  functionsPct: z.number().min(0).max(100).optional(),
  statementsPct: z.number().min(0).max(100).optional(),
  deltaPct: z.number().optional(),
}).strict();

export const componentRequirementSchema = z.object({
  repositoryId: z.coerce.number().int().positive(),
  componentKey: z.string().min(1).max(128),
  suiteKey: z.string().min(1).max(128),
  required: z.boolean().default(true),
  enabled: z.boolean().default(true),
  maxAgeMinutes: z.coerce.number().int().positive().optional(),
}).strict();

export const componentTestInputSchema = z.object({
  artifactId: z.coerce.number().int().positive(),
  evidenceId: z.coerce.number().int().positive(),
  componentKey: z.string().min(1).max(128),
  suiteKey: z.string().min(1).max(128),
  executionState: z.enum(["pending", "running", "completed"]).default("completed"),
  tests: z.array(testCaseSchema).default([]),
  coverage: coverageSchema.default({}),
  trend: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  observedAt: z.coerce.date(),
}).strict();

export type ComponentSuiteState = "pending" | "running" | "passed" | "failed" | "unstable";

export function confidenceKey(componentKey: string, suiteKey: string) {
  return `component:${componentKey}:suite:${suiteKey}`;
}

export function summarizeComponentSuite(input: z.infer<typeof componentTestInputSchema>) {
  if (input.executionState === "pending") return { state: "pending" as const, totals: { total: input.tests.length, passed: 0, failed: 0, error: 0, skipped: 0 }, flakyTests: [] as string[] };
  if (input.executionState === "running") return { state: "running" as const, totals: { total: input.tests.length, passed: 0, failed: 0, error: 0, skipped: 0 }, flakyTests: [] as string[] };

  const totals = { total: input.tests.length, passed: 0, failed: 0, error: 0, skipped: 0 };
  const flakyTests: string[] = [];
  for (const test of input.tests) {
    totals[test.status]++;
    if (test.flaky) flakyTests.push(test.name);
  }
  const failed = totals.failed > 0 || totals.error > 0;
  const state: ComponentSuiteState = failed ? "failed" : flakyTests.length > 0 ? "unstable" : "passed";
  return { state, totals, flakyTests };
}

export function toConfidenceState(state: ComponentSuiteState) {
  if (state === "unstable") return "failed" as const;
  return state;
}

export async function configureComponentSuite(db: Pool, raw: unknown) {
  const input = componentRequirementSchema.parse(raw);
  const row = (await db.query(
    `INSERT INTO component_test_requirements(repository_id,component_key,suite_key,required,enabled,max_age_minutes)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(repository_id,component_key,suite_key) DO UPDATE SET
       required=EXCLUDED.required, enabled=EXCLUDED.enabled, max_age_minutes=EXCLUDED.max_age_minutes, updated_at=now()
     RETURNING *`,
    [input.repositoryId, input.componentKey, input.suiteKey, input.required, input.enabled, input.maxAgeMinutes ?? null],
  )).rows[0];

  await configureConfidenceRequirement(db, {
    repositoryId: input.repositoryId,
    level: 2,
    key: confidenceKey(input.componentKey, input.suiteKey),
    required: input.required,
    enabled: input.enabled,
    maxAgeMinutes: input.maxAgeMinutes,
  });
  return row;
}

export async function ingestComponentSuite(db: Pool, raw: unknown) {
  const input = componentTestInputSchema.parse(raw);
  const artifactResult = await db.query("SELECT id,build_run_id,repository_id,commit_sha FROM artifacts WHERE id=$1", [input.artifactId]);
  if (!artifactResult.rowCount) throw new Error("Artifact does not exist");
  const artifact = artifactResult.rows[0];

  const evidenceResult = await db.query("SELECT id,artifact_id,build_run_id,evidence_type FROM evidence WHERE id=$1", [input.evidenceId]);
  if (!evidenceResult.rowCount) throw new Error("Evidence does not exist");
  const evidence = evidenceResult.rows[0];
  if (evidence.evidence_type !== "test") throw new Error("Component test source evidence must have evidence_type=test");
  if (Number(evidence.build_run_id) !== Number(artifact.build_run_id)) throw new Error("Evidence does not belong to artifact BuildRun");
  if (evidence.artifact_id == null || Number(evidence.artifact_id) !== input.artifactId) throw new Error("Component test evidence must reference the exact artifact");

  const normalized = summarizeComponentSuite(input);
  const result = (await db.query(
    `INSERT INTO component_test_results(
       artifact_id,build_run_id,repository_id,commit_sha,component_key,suite_key,state,evidence_id,totals,coverage,trend,flaky_tests,observed_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT(artifact_id,component_key,suite_key,evidence_id) DO UPDATE SET
       state=EXCLUDED.state, totals=EXCLUDED.totals, coverage=EXCLUDED.coverage,
       trend=EXCLUDED.trend, flaky_tests=EXCLUDED.flaky_tests, observed_at=EXCLUDED.observed_at, updated_at=now()
     RETURNING *`,
    [input.artifactId, artifact.build_run_id, artifact.repository_id, artifact.commit_sha, input.componentKey, input.suiteKey,
     normalized.state, input.evidenceId, normalized.totals, input.coverage, input.trend, normalized.flakyTests, input.observedAt],
  )).rows[0];

  const confidence = await recordConfidenceEvidence(db, {
    artifactId: input.artifactId,
    level: 2,
    key: confidenceKey(input.componentKey, input.suiteKey),
    state: toConfidenceState(normalized.state),
    evidenceId: input.evidenceId,
    observedAt: input.observedAt,
    metadata: {
      componentKey: input.componentKey,
      suiteKey: input.suiteKey,
      unstable: normalized.state === "unstable",
      flakyCount: normalized.flakyTests.length,
      ...Object.fromEntries(Object.entries(input.coverage).map(([key, value]) => [`coverage.${key}`, value])),
    },
  });
  return { result, confidence };
}

export async function listComponentSuites(db: Pool, artifactId: number) {
  return (await db.query(
    `SELECT * FROM component_test_results WHERE artifact_id=$1 ORDER BY component_key,suite_key,observed_at DESC,id DESC`,
    [artifactId],
  )).rows;
}
