import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { Pool } from "pg";
import { configureMergeGate, refreshMergeGates } from "./merge-gates";
import type { GitHubClient } from "./github/client";

test("PostgreSQL merge gating: promotion, staleness, lineage, newer builds and repository opt-out", { skip: !process.env.DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  const repositoryId = 5_000_000_000_000 + randomInt(1_000_000);
  const sha = "b".repeat(40);
  const writes: Array<{ conclusion: string; head_sha?: string }> = [];
  const github = {
    openPullRequests: async () => [{ number: 1, base: { ref: "main" }, head: { sha, repo: { id: repositoryId } } }],
    publishMergeGate: async (_installation: number, _repository: number, body: { conclusion: string; head_sha?: string }) => {
      writes.push(body); return { id: 100 };
    },
  } as unknown as GitHubClient;
  try {
    await db.query("BEGIN");
    // Keep this transaction's refresh isolated from other integration-test fixtures.
    await db.query("SELECT pg_advisory_xact_lock(160016)");
    await db.query(`INSERT INTO github_repositories(repository_id,installation_id,full_name,default_ref,workflow_id,workflow_path)
      VALUES($1,10,'test/merge-gates','heads/main',7,'.github/workflows/build.yml')`, [repositoryId]);
    await configureMergeGate(db, { repositoryId, branchPattern: "main", requiredLevel: 3, enabled: true }, "test:merge-gate");
    const build = (await db.query(`INSERT INTO build_runs(repository_id,installation_id,workflow_id,trigger_type,trigger_key,ref,commit_sha,status,requested_by)
      VALUES($1,10,7,'manual',$2,'heads/feature',$3,'succeeded','test') RETURNING id`, [repositoryId, `gate:${repositoryId}`, sha])).rows[0].id;
    const artifact = (await db.query(`INSERT INTO artifacts(digest_algorithm,digest,name,build_run_id,repository_id,commit_sha)
      VALUES('sha256',$1,'app',$2,$3,$4) RETURNING id`, [String(repositoryId).padStart(64, "0"), build, repositoryId, sha])).rows[0].id;
    const evidence = (await db.query(`INSERT INTO evidence(artifact_id,build_run_id,evidence_type,format,source,source_digest,raw_storage_ref,status,summary,provenance)
      VALUES($1,$2,'static_analysis','orbit-json','test',$3,'test://evidence','passed','{}','{}') RETURNING id`, [artifact, build, "c".repeat(64)])).rows[0].id;
    await db.query("INSERT INTO static_analysis_requirements(repository_id,provider,required,enabled) VALUES($1,'test',true,true)", [repositoryId]);
    await db.query(`INSERT INTO static_analysis_results(build_run_id,repository_id,commit_sha,provider,state,quality_gate,findings,trend,evidence_id,source_digest)
      VALUES($1,$2,$3,'test','passed','passed','{}','{}',$4,$5)`, [build, repositoryId, sha, evidence, "c".repeat(64)]);
    for (const level of [2, 3]) {
      await db.query("INSERT INTO confidence_requirements(repository_id,level,key,required,enabled,max_age_minutes) VALUES($1,$2,'suite',true,true,60)", [repositoryId, level]);
      await db.query(`INSERT INTO confidence_evidence_state(artifact_id,build_run_id,repository_id,level,key,state,evidence_id,observed_at,metadata)
        VALUES($1,$2,$3,$4,'suite','passed',$5,now(),'{}')`, [artifact, build, repositoryId, level, evidence]);
    }
    const refresh = async () => {
      await db.query("UPDATE github_repositories SET merge_gate_refresh_at=now() WHERE repository_id=$1", [repositoryId]);
      await refreshMergeGates(db, github);
    };
    await refresh();
    assert.equal(writes.at(-1)?.conclusion, "success");
    assert.equal(writes[0].head_sha, sha);
    await db.query("UPDATE confidence_evidence_state SET observed_at=now()-interval '2 hours' WHERE artifact_id=$1 AND level=3", [artifact]);
    await refresh();
    assert.equal(writes.at(-1)?.conclusion, "failure");
    await db.query("UPDATE confidence_evidence_state SET observed_at=now(),evidence_id=NULL WHERE artifact_id=$1 AND level=3", [artifact]);
    await refresh();
    assert.equal(writes.at(-1)?.conclusion, "failure");
    await db.query("UPDATE confidence_evidence_state SET evidence_id=$2 WHERE artifact_id=$1", [artifact, evidence]);
    await refresh();
    assert.equal(writes.at(-1)?.conclusion, "success");
    await db.query(`INSERT INTO build_runs(repository_id,installation_id,workflow_id,trigger_type,trigger_key,ref,commit_sha,status,requested_by)
      VALUES($1,10,7,'manual',$2,'heads/feature',$3,'queued','test')`, [repositoryId, `gate:new:${repositoryId}`, sha]);
    await refresh();
    assert.equal(writes.at(-1)?.conclusion, "failure");
    const decisions = await db.query("SELECT snapshot FROM merge_gate_decisions WHERE repository_id=$1 ORDER BY id", [repositoryId]);
    assert.ok(decisions.rows.length >= 4);
    assert.equal(decisions.rows[0].snapshot.assessments[0].artifactId, Number(artifact));
    assert.equal(decisions.rows[0].snapshot.assessments[0].level1Sources[0].evidence_id, evidence);
    await configureMergeGate(db, { repositoryId, branchPattern: "main", requiredLevel: 3, enabled: false }, "test:merge-gate");
    const count = writes.length;
    await refresh();
    assert.equal(writes.length, count);
    await db.query("SAVEPOINT immutable_audit");
    await assert.rejects(db.query("DELETE FROM merge_gate_decisions WHERE repository_id=$1", [repositoryId]), /append-only/);
    await db.query("ROLLBACK TO SAVEPOINT immutable_audit");
  } finally {
    await db.query("ROLLBACK"); db.release(); await pool.end();
  }
});
