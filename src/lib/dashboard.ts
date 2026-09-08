import type { Pool } from "pg";

export type DashboardFilters = {
  repositoryId?: number;
  branch?: string;
  binary?: string;
  from?: Date;
  artifactId?: number;
};

export function blockingStage(row: { confidence_level?: number | null; level_1_state?: string | null; level_2_state?: string | null; level_3_state?: string | null }) {
  if (Number(row.confidence_level ?? 0) >= 3) return null;
  if (row.level_1_state !== "passed") return { level: 1, state: row.level_1_state ?? "missing" };
  if (row.level_2_state !== "passed") return { level: 2, state: row.level_2_state ?? "missing" };
  return { level: 3, state: row.level_3_state ?? "missing" };
}

export function githubRunUrl(fullName: string, githubRunId: string | number | null) {
  return githubRunId ? `https://github.com/${fullName}/actions/runs/${githubRunId}` : null;
}

export async function getDashboard(db: Pool, filters: DashboardFilters = {}) {
  const repositories = (await db.query(
    `SELECT repository_id,full_name,default_ref,enabled,access_status,updated_at
     FROM github_repositories ORDER BY full_name`,
  )).rows;

  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.repositoryId) { params.push(filters.repositoryId); where.push(`b.repository_id=$${params.length}`); }
  if (filters.branch) { params.push(filters.branch); where.push(`b.ref=$${params.length}`); }
  if (filters.from) { params.push(filters.from); where.push(`b.requested_at >= $${params.length}`); }
  if (filters.binary) { params.push(`%${filters.binary}%`); where.push(`(a.name ILIKE $${params.length} OR a.digest ILIKE $${params.length})`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const builds = (await db.query(
    `SELECT b.id,b.repository_id,r.full_name,b.trigger_type,b.ref,b.commit_sha,b.github_run_id,b.status,b.requested_at,b.started_at,b.completed_at,
            count(a.id)::int AS artifact_count
     FROM build_runs b
     JOIN github_repositories r ON r.repository_id=b.repository_id
     LEFT JOIN artifacts a ON a.build_run_id=b.id
     ${whereSql}
     GROUP BY b.id,r.full_name
     ORDER BY b.requested_at DESC LIMIT 100`, params,
  )).rows.map((row) => ({ ...row, github_url: githubRunUrl(String(row.full_name), row.github_run_id) }));

  const artifacts = (await db.query(
    `SELECT a.id,a.name,a.digest_algorithm,a.digest,a.media_type,a.size_bytes,a.build_run_id,a.repository_id,a.commit_sha,a.storage_ref,a.created_at,
            r.full_name,b.ref,b.status AS build_status,b.github_run_id,b.requested_at,
            c.confidence_level,c.level_1_state,c.level_2_state,c.level_3_state,c.calculated_at
     FROM artifacts a
     JOIN build_runs b ON b.id=a.build_run_id
     JOIN github_repositories r ON r.repository_id=a.repository_id
     LEFT JOIN confidence_current c ON c.artifact_id=a.id
     ${whereSql}
     ORDER BY a.created_at DESC LIMIT 200`, params,
  )).rows.map((row) => ({ ...row, blocking_stage: blockingStage(row), github_url: githubRunUrl(String(row.full_name), row.github_run_id) }));

  const trendParams: unknown[] = [];
  const trendWhere: string[] = [];
  if (filters.repositoryId) { trendParams.push(filters.repositoryId); trendWhere.push(`a.repository_id=$${trendParams.length}`); }
  if (filters.from) { trendParams.push(filters.from); trendWhere.push(`t.created_at >= $${trendParams.length}`); }
  const trends = (await db.query(
    `SELECT t.id,t.artifact_id,a.name,a.digest,r.full_name,t.from_level,t.to_level,t.to_states,t.created_at
     FROM confidence_transitions t
     JOIN artifacts a ON a.id=t.artifact_id
     JOIN github_repositories r ON r.repository_id=a.repository_id
     ${trendWhere.length ? `WHERE ${trendWhere.join(" AND ")}` : ""}
     ORDER BY t.created_at DESC LIMIT 100`, trendParams,
  )).rows;

  let detail = null;
  if (filters.artifactId) {
    const artifact = artifacts.find((item) => Number(item.id) === filters.artifactId) ?? (await db.query(
      `SELECT a.*,r.full_name,b.ref,b.status AS build_status,b.github_run_id,b.requested_at,
              c.confidence_level,c.level_1_state,c.level_2_state,c.level_3_state,c.calculated_at
       FROM artifacts a JOIN build_runs b ON b.id=a.build_run_id JOIN github_repositories r ON r.repository_id=a.repository_id
       LEFT JOIN confidence_current c ON c.artifact_id=a.id WHERE a.id=$1`, [filters.artifactId],
    )).rows[0];
    if (artifact) {
      const evidence = (await db.query(
        `SELECT id,evidence_type,format,source,status,summary,raw_storage_ref,ingested_at FROM evidence
         WHERE artifact_id=$1 OR (artifact_id IS NULL AND build_run_id=$2) ORDER BY ingested_at DESC`,
        [filters.artifactId, artifact.build_run_id],
      )).rows;
      const componentTests = (await db.query(
        `SELECT component_key,suite_key,state,evidence_id,totals,coverage,trend,flaky_tests,observed_at FROM component_test_results
         WHERE artifact_id=$1 ORDER BY observed_at DESC`, [filters.artifactId],
      )).rows;
      const systemTests = (await db.query(
        `SELECT s.suite_key,s.state,s.evidence_id,s.provider_run_id,s.attempt,s.observed_at,s.metadata,
                p.provider_key,p.adapter_key,e.environment_key,e.environment_type,e.configuration
         FROM system_test_runs s JOIN system_test_providers p ON p.id=s.provider_id JOIN system_test_environments e ON e.id=s.environment_id
         WHERE s.artifact_id=$1 ORDER BY s.observed_at DESC`, [filters.artifactId],
      )).rows;
      const transitions = (await db.query(
        `SELECT id,from_level,to_level,from_states,to_states,created_at FROM confidence_transitions WHERE artifact_id=$1 ORDER BY created_at DESC`,
        [filters.artifactId],
      )).rows;
      detail = { artifact: { ...artifact, blocking_stage: blockingStage(artifact), github_url: githubRunUrl(String(artifact.full_name), artifact.github_run_id) }, evidence, componentTests, systemTests, transitions };
    }
  }

  return { repositories, builds, artifacts, trends, detail };
}
