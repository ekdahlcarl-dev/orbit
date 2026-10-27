import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { recalculateConfidence, type ConfidenceState } from "./confidence";
import { logger } from "./logger";
import { GitHubClient } from "./github/client";

export const mergeGatePolicySchema = z.object({
  repositoryId: z.number().int().positive(),
  branchPattern: z.string().min(1).max(255).regex(/^[A-Za-z0-9_./*\-]+$/),
  requiredLevel: z.number().int().min(1).max(3),
  enabled: z.boolean(),
}).strict();
type Policy = { branch_pattern: string; required_level: number; enabled: boolean };
export function requiredConfidence(policies: Policy[], branch: string): number | null {
  const matches = policies.filter(p => p.enabled && new RegExp(`^${p.branch_pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(branch));
  return matches.length ? Math.max(...matches.map(p => p.required_level)) : null;
}
// A fixed-length target identifier prevents same-SHA checks for different base branches colliding.
export function mergeGateCheckName(branch: string) {
  return `ORBIT confidence / ${createHash("sha256").update(branch).digest("hex")}`;
}
export function gatePasses(required: number, states: ConfidenceState[], lineageValid: boolean): boolean {
  return lineageValid && required >= 1 && required <= 3 && states.length >= required && states.slice(0, required).every(s => s === "passed");
}

export async function configureMergeGate(db: PoolClient, raw: unknown, actor: string) {
  const input = mergeGatePolicySchema.parse(raw);
  await db.query("SELECT pg_advisory_xact_lock(160016)");
  const repository = (await db.query("SELECT installation_id FROM github_repositories WHERE repository_id=$1 AND access_status='active' FOR UPDATE", [input.repositoryId])).rows[0];
  if (!repository) throw new Error("Repository is not active");
  const before = (await db.query("SELECT * FROM merge_gate_policies WHERE repository_id=$1 AND branch_pattern=$2", [input.repositoryId, input.branchPattern])).rows[0];
  const after = (await db.query(`INSERT INTO merge_gate_policies(repository_id,branch_pattern,required_level,enabled) VALUES($1,$2,$3,$4)
    ON CONFLICT(repository_id,branch_pattern) DO UPDATE SET required_level=EXCLUDED.required_level,enabled=EXCLUDED.enabled,updated_at=now() RETURNING *`,
  [input.repositoryId, input.branchPattern, input.requiredLevel, input.enabled])).rows[0];
  await db.query("INSERT INTO github_audit(actor,action,installation_id,repository_id,before_value,after_value) VALUES($1,'merge-gate.configure',$2,$3,$4,$5)", [actor, repository.installation_id, input.repositoryId, before ?? null, after]);
  await db.query("UPDATE github_repositories SET merge_gate_refresh_at=now() WHERE repository_id=$1", [input.repositoryId]);
  return after;
}

/** Called under a DB advisory lock. Recompute from source evidence, never trust cached confidence or AI output. */
export async function refreshMergeGates(db: PoolClient, github = new GitHubClient()) {
  const repositories = await db.query(`SELECT r.* FROM github_repositories r WHERE r.access_status='active' AND r.merge_gate_refresh_at<=now()
    AND EXISTS(SELECT 1 FROM merge_gate_policies p WHERE p.repository_id=r.repository_id AND p.enabled)`);
  for (const repository of repositories.rows) {
    const repositoryId = Number(repository.repository_id);
    const installationId = Number(repository.installation_id);
    await db.query("SAVEPOINT refresh_repository");
    try {
      const policies = (await db.query("SELECT * FROM merge_gate_policies WHERE repository_id=$1", [repositoryId])).rows as Policy[];
      const pulls = await github.openPullRequests(installationId, repositoryId);
      const seen = new Set<string>();
      for (const pull of pulls) {
        const branch = pull.base.ref;
        const sha = pull.head.sha;
        const required = requiredConfidence(policies, branch);
        if (required === null || seen.has(`${branch}:${sha}`)) continue;
        seen.add(`${branch}:${sha}`);
        // Fork commits cannot borrow evidence from an unrelated repository with the same SHA.
        const run = pull.head.repo?.id === repositoryId ? (await db.query(`SELECT * FROM build_runs WHERE repository_id=$1 AND commit_sha=$2 ORDER BY requested_at DESC,id DESC LIMIT 1`, [repositoryId, sha])).rows[0] : undefined;
        const artifacts = run ? (await db.query("SELECT * FROM artifacts WHERE build_run_id=$1 AND repository_id=$2 AND commit_sha=$3 ORDER BY id", [run.id, repositoryId, sha])).rows : [];
        const assessments = [];
        for (const artifact of artifacts) {
          const confidence = await recalculateConfidence(db, Number(artifact.id));
          // Passing observations require immutable, matching source evidence, including L1.
          const invalid = await db.query(`SELECT 1 FROM confidence_evidence_state c
            JOIN confidence_requirements r ON r.repository_id=$4 AND r.level=c.level AND r.key=c.key
              AND r.enabled=true AND r.required=true
            LEFT JOIN evidence e ON e.id=c.evidence_id
            WHERE c.artifact_id=$1 AND c.level<=$2 AND c.state='passed' AND
            (c.build_run_id<>$3 OR c.repository_id<>$4 OR c.observed_at>now() OR e.id IS NULL OR e.status<>'passed'
             OR e.build_run_id<>$3 OR (e.artifact_id IS NOT NULL AND e.artifact_id<>$1)) LIMIT 1`,
          [artifact.id, required, run.id, repositoryId]);
          // Select the same latest enabled, required provider results as getLevel1Assessment.
          // Validate after selecting the latest row: an invalid retry must not fall back to older evidence.
          const sources = await db.query(`SELECT s.id AS result_id,s.evidence_id,s.provider,
              (s.commit_sha=$3 AND s.repository_id=$2 AND s.state='passed' AND s.quality_gate='passed'
               AND e.id IS NOT NULL AND e.build_run_id=$1 AND e.status='passed') AS lineage_valid
            FROM static_analysis_requirements r
            JOIN LATERAL (
              SELECT * FROM static_analysis_results WHERE build_run_id=$1 AND provider=r.provider
              ORDER BY created_at DESC,id DESC LIMIT 1
            ) s ON true
            LEFT JOIN evidence e ON e.id=s.evidence_id
            WHERE r.repository_id=$2 AND r.enabled=true AND r.required=true
            ORDER BY s.provider`, [run.id, repositoryId, sha]);
          const states = [confidence.level_1_state, confidence.level_2_state, confidence.level_3_state] as ConfidenceState[];
          assessments.push({ artifactId: Number(artifact.id), digest: artifact.digest, buildRunId: Number(run.id), states,
            passed: gatePasses(required, states, !invalid.rowCount && sources.rows.every(source => source.lineage_valid === true)), level1Sources: sources.rows, snapshot: confidence.snapshot });
        }
        const passed = run?.status === "succeeded" && assessments.length > 0 && assessments.every(a => a.passed);
        const snapshot = { branch, commitSha: sha, requiredLevel: required, passed: Boolean(passed), buildRunId: run ? Number(run.id) : null,
          buildStatus: run?.status ?? "missing", assessments, source: "deterministic-engine" };
        const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
        const previous = (await db.query("SELECT * FROM merge_gate_checks WHERE repository_id=$1 AND target_branch=$2 AND commit_sha=$3", [repositoryId, branch, sha])).rows[0];
        if (previous?.decision_digest === digest) continue;
        const summary = `Target: ${branch}\nRequired: L${required}\nCommit: ${sha}\nBuild: ${run?.id ?? "missing"} (${run?.status ?? "missing"})\n` +
          assessments.map(a => `Artifact ${a.artifactId} (${a.digest}): L1 ${a.states[0]}, L2 ${a.states[1]}, L3 ${a.states[2]}; lineage ${a.passed ? "satisfied" : "not satisfied"}`).join("\n");
        const check = await github.publishMergeGate(installationId, repositoryId, {
          name: mergeGateCheckName(branch), ...(!previous ? { head_sha: sha } : {}),
          external_id: `orbit:${repositoryId}:${digest}`, status: "completed", conclusion: passed ? "success" : "failure",
          output: { title: passed ? `Required L${required} satisfied` : `Required L${required} not satisfied`, summary },
        }, previous ? Number(previous.check_run_id) : undefined);
        await db.query(`INSERT INTO merge_gate_checks(repository_id,target_branch,commit_sha,check_run_id,decision_digest) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(repository_id,target_branch,commit_sha) DO UPDATE SET check_run_id=EXCLUDED.check_run_id,decision_digest=EXCLUDED.decision_digest,updated_at=now()`, [repositoryId, branch, sha, check.id, digest]);
        await db.query("INSERT INTO merge_gate_decisions(repository_id,target_branch,commit_sha,check_run_id,snapshot) VALUES($1,$2,$3,$4,$5)", [repositoryId, branch, sha, check.id, snapshot]);
      }
      await db.query("UPDATE github_repositories SET merge_gate_refresh_at=now()+interval '30 seconds' WHERE repository_id=$1", [repositoryId]);
    } catch (error) {
      await db.query("ROLLBACK TO SAVEPOINT refresh_repository");
      await db.query("UPDATE github_repositories SET merge_gate_refresh_at=now()+interval '30 seconds' WHERE repository_id=$1", [repositoryId]);
      logger.error({ err: error, repositoryId }, "merge gate repository refresh failed; retry scheduled");
    }
  }
}
