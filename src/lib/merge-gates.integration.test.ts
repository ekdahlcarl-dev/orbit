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

/** Transaction-local fixtures exercise real PostgreSQL selection and confidence recomputation.
 * GitHub is mocked so regression tests cannot publish checks to a real repository.
 */
async function withSelectionFixture(work: (fixture: {
  db: import("pg").PoolClient;
  repositoryId: number;
  build: string;
  artifact: string;
  evidence: string;
  sha: string;
  refresh: () => Promise<{ passed: boolean; assessments: Array<{ level1Sources: Array<{ result_id: string; provider: string; lineage_valid: boolean }> }> }>;
}) => Promise<void>) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = await pool.connect();
  const repositoryId = 4_000_000_000_000 + randomInt(1_000_000);
  const sha = "d".repeat(40);
  const publications: string[] = [];
  const github = {
    openPullRequests: async () => [{ number: 1, base: { ref: "main" }, head: { sha, repo: { id: repositoryId } } }],
    publishMergeGate: async (_installation: number, _repository: number, body: { conclusion: string }) => {
      publications.push(body.conclusion); return { id: 200 };
    },
  } as unknown as GitHubClient;
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(160016)");
    await db.query(`INSERT INTO github_repositories(repository_id,installation_id,full_name,default_ref,workflow_id,workflow_path)
      VALUES($1,10,'test/selection','heads/main',7,'.github/workflows/build.yml')`, [repositoryId]);
    await configureMergeGate(db, { repositoryId, branchPattern: "main", requiredLevel: 3, enabled: true }, "test:selection");
    const build = (await db.query(`INSERT INTO build_runs(repository_id,installation_id,workflow_id,trigger_type,trigger_key,ref,commit_sha,status,requested_by)
      VALUES($1,10,7,'manual',$2,'heads/feature',$3,'succeeded','test') RETURNING id`, [repositoryId, `selection:${repositoryId}`, sha])).rows[0].id;
    const artifact = (await db.query(`INSERT INTO artifacts(digest_algorithm,digest,name,build_run_id,repository_id,commit_sha)
      VALUES('sha256',$1,'app',$2,$3,$4) RETURNING id`, [String(repositoryId).padStart(64, "0"), build, repositoryId, sha])).rows[0].id;
    const evidence = (await db.query(`INSERT INTO evidence(artifact_id,build_run_id,evidence_type,format,source,source_digest,raw_storage_ref,status,summary,provenance)
      VALUES($1,$2,'static_analysis','orbit-json','test',$3,'test://selection','passed','{}','{}') RETURNING id`, [artifact, build, "e".repeat(64)])).rows[0].id;
    await db.query("INSERT INTO static_analysis_requirements(repository_id,provider,required,enabled) VALUES($1,'test',true,true)", [repositoryId]);
    await db.query(`INSERT INTO static_analysis_results(build_run_id,repository_id,commit_sha,provider,state,quality_gate,evidence_id,source_digest)
      VALUES($1,$2,$3,'test','passed','passed',$4,$5)`, [build, repositoryId, sha, evidence, "e".repeat(64)]);
    for (const level of [2, 3]) {
      await db.query("INSERT INTO confidence_requirements(repository_id,level,key,required,enabled) VALUES($1,$2,'suite',true,true)", [repositoryId, level]);
      await db.query(`INSERT INTO confidence_evidence_state(artifact_id,build_run_id,repository_id,level,key,state,evidence_id,observed_at)
        VALUES($1,$2,$3,$4,'suite','passed',$5,now())`, [artifact, build, repositoryId, level, evidence]);
    }
    const refresh = async () => {
      await db.query("UPDATE github_repositories SET merge_gate_refresh_at=now() WHERE repository_id=$1", [repositoryId]);
      await refreshMergeGates(db, github);
      const result = await db.query("SELECT snapshot FROM merge_gate_decisions WHERE repository_id=$1 ORDER BY id DESC LIMIT 1", [repositoryId]);
      assert.equal(result.rowCount, 1, "refresh must persist an audited decision, not silently roll back");
      assert.equal(publications.at(-1), result.rows[0].snapshot.passed ? "success" : "failure");
      return result.rows[0].snapshot;
    };
    await work({ db, repositoryId, build, artifact, evidence, sha, refresh });
  } finally {
    await db.query("ROLLBACK"); db.release(); await pool.end();
  }
}

test("PostgreSQL merge gates select the latest required L1 retry and ignore optional or disabled providers", { skip: !process.env.DATABASE_URL }, async () => {
  await withSelectionFixture(async ({ db, repositoryId, build, artifact, sha, refresh }) => {
    const failedEvidence = (await db.query(`INSERT INTO evidence(artifact_id,build_run_id,evidence_type,format,source,source_digest,raw_storage_ref,status,summary,provenance)
      VALUES($1,$2,'static_analysis','orbit-json','test',$3,'test://failed','failed','{}','{}') RETURNING id`, [artifact, build, "f".repeat(64)])).rows[0].id;
    for (const provider of ["test", "optional", "disabled"]) {
      if (provider !== "test") await db.query("INSERT INTO static_analysis_requirements(repository_id,provider,required,enabled) VALUES($1,$2,$3,$4)", [repositoryId, provider, provider !== "optional", provider !== "disabled"]);
      await db.query(`INSERT INTO static_analysis_results(build_run_id,repository_id,commit_sha,provider,state,quality_gate,evidence_id,source_digest)
        VALUES($1,$2,$3,$4,'failed','failed',$5,$6)`, [build, repositoryId, sha, provider, failedEvidence, "f".repeat(64)]);
    }
    const retryEvidence = (await db.query(`INSERT INTO evidence(artifact_id,build_run_id,evidence_type,format,source,source_digest,raw_storage_ref,status,summary,provenance)
      VALUES($1,$2,'static_analysis','orbit-json','test',$3,'test://retry','passed','{}','{}') RETURNING id`, [artifact, build, "a".repeat(64)])).rows[0].id;
    // Same transaction timestamp: newest ID must win the created_at tie.
    const retry = (await db.query(`INSERT INTO static_analysis_results(build_run_id,repository_id,commit_sha,provider,state,quality_gate,evidence_id,source_digest)
      VALUES($1,$2,$3,'test','passed','passed',$4,$5) RETURNING id`, [build, repositoryId, sha, retryEvidence, "a".repeat(64)])).rows[0].id;
    const decision = await refresh();
    assert.equal(decision.passed, true, "a successful retry must supersede failed history");
    assert.deepEqual(decision.assessments[0].level1Sources, [{ result_id: retry, evidence_id: retryEvidence, provider: "test", lineage_valid: true }]);

    await db.query("UPDATE static_analysis_results SET evidence_id=$2 WHERE id=$1", [retry, failedEvidence]);
    assert.equal((await refresh()).passed, false, "invalid latest required source must not fall back to older passing results");
    await db.query("UPDATE static_analysis_results SET evidence_id=$2 WHERE id=$1", [retry, retryEvidence]);
    assert.equal((await refresh()).passed, true);
    await db.query("UPDATE static_analysis_results SET commit_sha=$2 WHERE id=$1", [retry, "0".repeat(40)]);
    assert.equal((await refresh()).passed, false, "latest source with the wrong SHA must still block");
    await db.query("UPDATE static_analysis_results SET commit_sha=$2 WHERE id=$1", [retry, sha]);
    assert.equal((await refresh()).passed, true);
    await db.query("UPDATE static_analysis_requirements SET required=true WHERE repository_id=$1 AND provider='optional'", [repositoryId]);
    assert.equal((await refresh()).passed, false, "an optional provider becomes blocking when required");
  });
});

test("PostgreSQL merge gates ignore non-required observations while retaining required-source and freshness checks", { skip: !process.env.DATABASE_URL }, async () => {
  await withSelectionFixture(async ({ db, repositoryId, build, artifact, evidence, sha, refresh }) => {
    for (const level of [2, 3]) {
      for (const key of ["optional", "disabled", "removed"]) {
        if (key !== "removed") await db.query("INSERT INTO confidence_requirements(repository_id,level,key,required,enabled) VALUES($1,$2,$3,$4,$5)", [repositoryId, level, key, key !== "optional", key !== "disabled"]);
        await db.query(`INSERT INTO confidence_evidence_state(artifact_id,build_run_id,repository_id,level,key,state,evidence_id,observed_at)
          VALUES($1,$2,$3,$4,$5,'passed',NULL,now())`, [artifact, build, repositoryId, level, key]);
      }
    }
    assert.equal((await refresh()).passed, true, "optional, disabled and removed keys must not veto required confidence");
    await db.query("UPDATE confidence_requirements SET required=true WHERE repository_id=$1 AND level=2 AND key='optional'", [repositoryId]);
    assert.equal((await refresh()).passed, false, "a source-less key must block as soon as it becomes required");
    await db.query("UPDATE confidence_requirements SET required=false WHERE repository_id=$1 AND level=2 AND key='optional'", [repositoryId]);
    assert.equal((await refresh()).passed, true);
    await db.query("UPDATE confidence_requirements SET enabled=true WHERE repository_id=$1 AND level=3 AND key='disabled'", [repositoryId]);
    assert.equal((await refresh()).passed, false, "re-enabling a required key must restore lineage enforcement");
    await db.query("UPDATE confidence_requirements SET enabled=false WHERE repository_id=$1 AND level=3 AND key='disabled'", [repositoryId]);
    assert.equal((await refresh()).passed, true);
    await db.query("UPDATE confidence_evidence_state SET evidence_id=NULL WHERE artifact_id=$1 AND level=3 AND key='suite'", [artifact]);
    assert.equal((await refresh()).passed, false, "a required key still needs source evidence");
    await db.query("UPDATE confidence_evidence_state SET evidence_id=$2 WHERE artifact_id=$1 AND level=3 AND key='suite'", [artifact, evidence]);
    assert.equal((await refresh()).passed, true);
    const otherArtifact = (await db.query(`INSERT INTO artifacts(digest_algorithm,digest,name,build_run_id,repository_id,commit_sha)
      VALUES('sha256',$1,'other',$2,$3,$4) RETURNING id`, [String(repositoryId + 2_000_000).padStart(64, "0"), build, repositoryId, sha])).rows[0].id;
    const otherEvidence = (await db.query(`INSERT INTO evidence(artifact_id,build_run_id,evidence_type,format,source,source_digest,raw_storage_ref,status,summary,provenance)
      VALUES($1,$2,'test','orbit-json','test',$3,'test://other','passed','{}','{}') RETURNING id`, [otherArtifact, build, "b".repeat(64)])).rows[0].id;
    // Keep the second artifact independently valid so only the mismatched source can block the first.
    for (const level of [2, 3]) {
      await db.query(`INSERT INTO confidence_evidence_state(artifact_id,build_run_id,repository_id,level,key,state,evidence_id,observed_at)
        VALUES($1,$2,$3,$4,'suite','passed',$5,now())`, [otherArtifact, build, repositoryId, level, otherEvidence]);
    }
    await db.query("UPDATE confidence_evidence_state SET evidence_id=$2 WHERE artifact_id=$1 AND level=3 AND key='suite'", [artifact, otherEvidence]);
    assert.equal((await refresh()).passed, false, "a different artifact's passing evidence must block");
    await db.query("UPDATE confidence_evidence_state SET evidence_id=$2,observed_at=now()+interval '1 hour' WHERE artifact_id=$1 AND level=3 AND key='suite'", [artifact, evidence]);
    assert.equal((await refresh()).passed, false, "required future-dated observations must block");
    await db.query("UPDATE confidence_evidence_state SET observed_at=now() WHERE artifact_id=$1 AND level=3 AND key='suite'", [artifact]);
    assert.equal((await refresh()).passed, true);
  });
});
