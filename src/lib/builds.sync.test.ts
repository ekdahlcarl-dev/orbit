import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { syncWorkflowRun } from "./builds";

const run = { id: 9001, workflow_id: 123, head_sha: "abc", status: "completed", conclusion: "success" };

test("completed workflow updates only one build, not all builds on the same SHA", async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("WHERE github_run_id=$1")) return { rows: [] };
      if (sql.includes("github_run_id IS NULL")) return { rows: [{ id: 28 }] };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  assert.deepEqual(await syncWorkflowRun(db, 1, 2, run), { buildRunId: 28, status: "succeeded" });
  const updates = calls.filter(call => call.sql.startsWith("UPDATE build_runs"));
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /WHERE id=\$1/);
  assert.deepEqual(updates[0].params, [28, 9001, "succeeded"]);
  assert.match(calls[1].sql, /LIMIT 1 FOR UPDATE SKIP LOCKED/);
});

test("redelivered workflow updates its existing build without claiming another", async () => {
  const calls: string[] = [];
  const db = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("WHERE github_run_id=$1")) return { rows: [{ id: 28 }] };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  await syncWorkflowRun(db, 1, 2, run);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(sql => sql.includes("github_run_id IS NULL")), false);
});

test("unmatched workflow does not update any build", async () => {
  const calls: string[] = [];
  const db = {
    async query(sql: string) { calls.push(sql); return { rows: [] }; },
  } as unknown as PoolClient;
  assert.equal(await syncWorkflowRun(db, 1, 2, run), null);
  assert.equal(calls.some(sql => sql.startsWith("UPDATE build_runs")), false);
});
