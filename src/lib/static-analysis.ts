import { createHash } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";

export type Level1State = "not-configured" | "pending" | "running" | "failed" | "passed";
export type GateState = Exclude<Level1State, "not-configured">;

const findingsSchema = z.object({
  bugs: z.number().int().nonnegative().optional(),
  vulnerabilities: z.number().int().nonnegative().optional(),
  codeSmells: z.number().int().nonnegative().optional(),
  securityHotspots: z.number().int().nonnegative().optional(),
}).strict();

const trendSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const requirementSchema = z.object({
  repositoryId: z.coerce.number().int().positive(),
  provider: z.string().min(1).max(64),
  required: z.boolean().default(true),
  enabled: z.boolean().default(true),
}).strict();

export const sonarInputSchema = z.object({
  buildRunId: z.coerce.number().int().positive(),
  commitSha: z.string().min(7).max(64),
  evidenceId: z.coerce.number().int().positive(),
  qualityGateStatus: z.enum(["OK", "ERROR", "PENDING", "IN_PROGRESS"]),
  findings: findingsSchema.default({}),
  trend: trendSchema.default({}),
  projectKey: z.string().min(1).max(512).optional(),
  analysisId: z.string().min(1).max(512).optional(),
}).strict();

export type StaticAnalysisResult = {
  provider: string;
  buildRunId: number;
  commitSha: string;
  evidenceId: number;
  state: GateState;
  qualityGate: GateState;
  findings: z.infer<typeof findingsSchema>;
  trend: z.infer<typeof trendSchema>;
  provenance: Record<string, string | number | boolean | null>;
};

export interface StaticAnalysisAdapter<T = unknown> {
  provider: string;
  normalize(input: T): StaticAnalysisResult;
}

export function mapSonarState(status: z.infer<typeof sonarInputSchema>["qualityGateStatus"]): GateState {
  if (status === "OK") return "passed";
  if (status === "ERROR") return "failed";
  if (status === "IN_PROGRESS") return "running";
  return "pending";
}

export const sonarAdapter: StaticAnalysisAdapter<unknown> = {
  provider: "sonar",
  normalize(raw) {
    const input = sonarInputSchema.parse(raw);
    const state = mapSonarState(input.qualityGateStatus);
    return {
      provider: "sonar",
      buildRunId: input.buildRunId,
      commitSha: input.commitSha,
      evidenceId: input.evidenceId,
      state,
      qualityGate: state,
      findings: input.findings,
      trend: input.trend,
      provenance: {
        ...(input.projectKey ? { projectKey: input.projectKey } : {}),
        ...(input.analysisId ? { analysisId: input.analysisId } : {}),
      },
    };
  },
};

export function determineLevel1(requiredStates: Array<GateState | null>): Level1State {
  if (requiredStates.length === 0) return "not-configured";
  if (requiredStates.some((state) => state === "failed")) return "failed";
  if (requiredStates.some((state) => state === "running")) return "running";
  if (requiredStates.some((state) => state === null || state === "pending")) return "pending";
  return "passed";
}

export async function configureStaticAnalysis(db: Pool, raw: unknown) {
  const input = requirementSchema.parse(raw);
  return (await db.query(
    `INSERT INTO static_analysis_requirements(repository_id,provider,required,enabled)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(repository_id,provider) DO UPDATE
       SET required=EXCLUDED.required, enabled=EXCLUDED.enabled, updated_at=now()
     RETURNING *`,
    [input.repositoryId, input.provider, input.required, input.enabled],
  )).rows[0];
}

export async function ingestStaticAnalysis(db: Pool, provider: string, raw: unknown) {
  const adapter = provider === "sonar" ? sonarAdapter : null;
  if (!adapter) throw new Error(`Unsupported static analysis provider: ${provider}`);
  const result = adapter.normalize(raw);

  const run = await db.query("SELECT id,repository_id,commit_sha FROM build_runs WHERE id=$1", [result.buildRunId]);
  if (!run.rowCount) throw new Error("BuildRun does not exist");
  const build = run.rows[0];
  if (build.commit_sha !== result.commitSha) throw new Error("Static analysis commit does not match BuildRun");

  const evidence = await db.query(
    "SELECT id,build_run_id,evidence_type,source_digest FROM evidence WHERE id=$1",
    [result.evidenceId],
  );
  if (!evidence.rowCount) throw new Error("Source evidence does not exist");
  const sourceEvidence = evidence.rows[0];
  if (Number(sourceEvidence.build_run_id) !== result.buildRunId) throw new Error("Static analysis evidence does not belong to BuildRun");
  if (sourceEvidence.evidence_type !== "static_analysis") throw new Error("Source evidence is not static analysis evidence");

  return (await db.query(
    `INSERT INTO static_analysis_results(
       build_run_id,repository_id,commit_sha,provider,state,quality_gate,findings,trend,evidence_id,source_digest
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(build_run_id,provider,source_digest) DO UPDATE
       SET state=EXCLUDED.state, quality_gate=EXCLUDED.quality_gate,
           findings=EXCLUDED.findings, trend=EXCLUDED.trend, evidence_id=EXCLUDED.evidence_id
     RETURNING *`,
    [
      result.buildRunId,
      build.repository_id,
      result.commitSha,
      result.provider,
      result.state,
      result.qualityGate,
      result.findings,
      { ...result.trend, provenance: result.provenance },
      result.evidenceId,
      sourceEvidence.source_digest,
    ],
  )).rows[0];
}

export async function getLevel1Assessment(db: Pool, buildRunId: number) {
  const run = await db.query("SELECT id,repository_id,commit_sha FROM build_runs WHERE id=$1", [buildRunId]);
  if (!run.rowCount) throw new Error("BuildRun does not exist");
  const build = run.rows[0];

  const requirements = await db.query(
    "SELECT provider,required FROM static_analysis_requirements WHERE repository_id=$1 AND enabled=true ORDER BY provider",
    [build.repository_id],
  );
  const requiredProviders = requirements.rows.filter((row) => row.required).map((row) => String(row.provider));
  const providerStates: Record<string, GateState | null> = {};

  for (const provider of requiredProviders) {
    const latest = await db.query(
      `SELECT state,evidence_id,findings,trend,created_at
       FROM static_analysis_results
       WHERE build_run_id=$1 AND provider=$2
       ORDER BY created_at DESC,id DESC LIMIT 1`,
      [buildRunId, provider],
    );
    providerStates[provider] = latest.rowCount ? latest.rows[0].state as GateState : null;
  }

  return {
    buildRunId,
    repositoryId: Number(build.repository_id),
    commitSha: build.commit_sha,
    level: 1,
    status: determineLevel1(Object.values(providerStates)),
    providers: providerStates,
    deterministic: true,
  };
}

export function staticAnalysisDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
