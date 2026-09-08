import type { Pool } from "pg";

export type RiskSignals = {
  churn: number;
  coverageGap: number;
  repeatedFailures: number;
  flakiness: number;
  defectHistory: number;
  criticality: number;
  evidenceAge: number;
};

export const RISK_WEIGHTS: Record<keyof RiskSignals, number> = {
  churn: 0.18,
  coverageGap: 0.20,
  repeatedFailures: 0.18,
  flakiness: 0.12,
  defectHistory: 0.10,
  criticality: 0.12,
  evidenceAge: 0.10,
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function calculateRisk(signals: RiskSignals) {
  const contributions = Object.fromEntries(
    Object.entries(RISK_WEIGHTS).map(([key, weight]) => [key, Number((clamp(signals[key as keyof RiskSignals]) * weight).toFixed(2))]),
  ) as Record<keyof RiskSignals, number>;
  const score = Number(Object.values(contributions).reduce((sum, value) => sum + value, 0).toFixed(2));
  return { score, signals, weights: RISK_WEIGHTS, contributions, modelVersion: "orbit-risk-v1" };
}

export async function affectedComponents(db: Pool, repositoryId: number, commitSha: string) {
  return (await db.query(
    `WITH RECURSIVE affected(id,depth,path) AS (
       SELECT kc.component_id,0,ARRAY[kc.component_id]::bigint[]
       FROM knowledge_commit_components kc WHERE kc.repository_id=$1 AND kc.commit_sha=$2
       UNION ALL
       SELECT d.from_component_id,a.depth+1,a.path || d.from_component_id
       FROM affected a JOIN knowledge_dependencies d ON d.to_component_id=a.id
       WHERE a.depth < 20 AND NOT d.from_component_id = ANY(a.path)
     )
     SELECT DISTINCT c.id,c.repository_id,c.key,c.name,c.kind,c.criticality,min(a.depth)::int AS dependency_depth
     FROM affected a JOIN knowledge_components c ON c.id=a.id
     GROUP BY c.id ORDER BY min(a.depth),c.key`, [repositoryId, commitSha],
  )).rows;
}

export async function affectedTests(db: Pool, repositoryId: number, commitSha: string) {
  return (await db.query(
    `WITH RECURSIVE affected(id,path) AS (
       SELECT component_id,ARRAY[component_id]::bigint[] FROM knowledge_commit_components WHERE repository_id=$1 AND commit_sha=$2
       UNION ALL
       SELECT d.from_component_id,a.path || d.from_component_id FROM affected a JOIN knowledge_dependencies d ON d.to_component_id=a.id
       WHERE cardinality(a.path) < 21 AND NOT d.from_component_id = ANY(a.path)
     )
     SELECT DISTINCT t.test_key,t.level,t.capability_key,c.key AS component_key
     FROM affected a JOIN knowledge_components c ON c.id=a.id JOIN knowledge_test_components t ON t.component_id=a.id
     ORDER BY t.level,t.test_key`, [repositoryId, commitSha],
  )).rows;
}

export async function calculateComponentRisk(db: Pool, componentId: number) {
  const component = (await db.query(`SELECT * FROM knowledge_components WHERE id=$1`, [componentId])).rows[0];
  if (!component) throw new Error("Component does not exist");

  const churn = (await db.query(
    `SELECT count(*)::int commits,coalesce(sum(files_changed),0)::int files,coalesce(sum(lines_added+lines_deleted),0)::int lines
     FROM knowledge_commit_components WHERE component_id=$1 AND observed_at >= now()-interval '30 days'`, [componentId],
  )).rows[0];
  const suites = (await db.query(
    `SELECT state,coverage,flaky_tests,observed_at FROM component_test_results
     WHERE repository_id=$1 AND component_key=$2 AND observed_at >= now()-interval '90 days'`, [component.repository_id, component.key],
  )).rows;
  const confidence = (await db.query(
    `SELECT ce.state,ce.observed_at FROM confidence_evidence_state ce
     JOIN artifacts a ON a.id=ce.artifact_id WHERE a.repository_id=$1 AND ce.metadata->>'componentKey'=$2
     ORDER BY ce.observed_at DESC LIMIT 20`, [component.repository_id, component.key],
  )).rows;

  const latestCoverage = suites.map((s) => Number(s.coverage?.linesPct ?? s.coverage?.statementsPct ?? 0)).filter(Number.isFinite);
  const failures = suites.filter((s) => s.state === "failed").length;
  const flaky = suites.reduce((sum, s) => sum + (Array.isArray(s.flaky_tests) ? s.flaky_tests.length : 0), 0);
  const latestEvidence = [...suites, ...confidence].map((r) => new Date(r.observed_at).getTime()).filter(Number.isFinite).sort((a,b) => b-a)[0];
  const ageDays = latestEvidence ? (Date.now()-latestEvidence)/86400000 : 90;

  const signals: RiskSignals = {
    churn: clamp(Number(churn.commits) * 8 + Number(churn.lines) / 100),
    coverageGap: latestCoverage.length ? clamp(100-Math.max(...latestCoverage)) : 100,
    repeatedFailures: clamp(failures * 20),
    flakiness: clamp(flaky * 15),
    defectHistory: clamp(confidence.filter((c) => c.state === "failed").length * 15),
    criticality: clamp((Number(component.criticality)-1) * 25),
    evidenceAge: clamp(ageDays / 30 * 100),
  };
  const result = calculateRisk(signals);
  await db.query(`INSERT INTO component_risk_snapshots(component_id,repository_id,score,signals,model_version) VALUES($1,$2,$3,$4,$5)`,
    [componentId, component.repository_id, result.score, { ...result.signals, weights: result.weights, contributions: result.contributions }, result.modelVersion]);
  return { component, ...result };
}

export async function rankComponentRisk(db: Pool, repositoryId?: number) {
  const components = (await db.query(`SELECT id FROM knowledge_components ${repositoryId ? "WHERE repository_id=$1" : ""} ORDER BY id`, repositoryId ? [repositoryId] : [])).rows;
  const results = [];
  for (const component of components) results.push(await calculateComponentRisk(db, Number(component.id)));
  return results.sort((a,b) => b.score-a.score);
}
