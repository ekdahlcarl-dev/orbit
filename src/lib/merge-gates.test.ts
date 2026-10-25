import { test } from "node:test";
import assert from "node:assert/strict";
import { gatePasses, mergeGateCheckName, mergeGatePolicySchema, requiredConfidence } from "./merge-gates";
import type { ConfidenceState } from "./confidence";

test("branch policies use the strongest matching requirement and ignore disabled entries", () => {
  const policies = [
    { branch_pattern: "*", required_level: 1, enabled: true },
    { branch_pattern: "release/*", required_level: 3, enabled: true },
    { branch_pattern: "develop", required_level: 2, enabled: true },
    { branch_pattern: "main", required_level: 3, enabled: false },
  ];
  assert.equal(requiredConfidence(policies, "release/2026/10"), 3);
  assert.equal(requiredConfidence(policies, "develop"), 2);
  assert.equal(requiredConfidence(policies, "main"), 1);
  assert.equal(requiredConfidence([], "main"), null);
  assert.equal(requiredConfidence([{ branch_pattern: "release/1.0", required_level: 2, enabled: true }], "release/1x0"), null);
});
test("only contiguous passing states with valid lineage satisfy a gate", () => {
  for (const state of ["not-configured", "pending", "running", "failed", "blocked", "stale"] as ConfidenceState[]) {
    for (let level = 1; level <= 3; level++) {
      const states: ConfidenceState[] = ["passed", "passed", "passed"];
      states[level - 1] = state;
      assert.equal(gatePasses(3, states, true), false);
    }
  }
  assert.equal(gatePasses(2, ["passed", "passed", "not-configured"], true), true);
  assert.equal(gatePasses(3, ["passed", "passed", "passed"], false), false);
  assert.equal(gatePasses(3, ["passed", "passed"], true), false);
  assert.equal(gatePasses(0, ["passed"], true), false);
});
test("check names bind to an exact target branch", () => {
  assert.equal(mergeGateCheckName("main"), mergeGateCheckName("main"));
  assert.notEqual(mergeGateCheckName("main"), mergeGateCheckName("develop"));
  assert.notEqual(mergeGateCheckName("release/a"), mergeGateCheckName("release-a"));
});
test("configuration rejects override fields and invalid confidence levels", () => {
  const input = { repositoryId: 1, branchPattern: "main", requiredLevel: 3, enabled: true };
  assert.equal(mergeGatePolicySchema.safeParse(input).success, true);
  for (const requiredLevel of [0, 4, 2.5]) assert.equal(mergeGatePolicySchema.safeParse({ ...input, requiredLevel }).success, false);
  assert.equal(mergeGatePolicySchema.safeParse({ ...input, passed: true }).success, false);
});

test("worker publishes a blocking exact-SHA check for missing evidence, deduplicates and isolates repository failures", async () => {
  const { refreshMergeGates } = await import("./merge-gates");
  const calls: Array<{ repositoryId: number; body: Record<string, unknown> }> = [];
  const stored = new Map<number, { check_run_id: number; decision_digest: string }>();
  const decisions: unknown[] = [];
  const db = { query: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("SELECT r.*")) return { rows: [1, 2].map(id => ({ repository_id: id, installation_id: 10 })), rowCount: 2 };
    if (sql.startsWith("SELECT * FROM merge_gate_policies")) return { rows: [{ branch_pattern: "main", required_level: 3, enabled: true }], rowCount: 1 };
    if (sql.startsWith("SELECT * FROM build_runs")) { assert.equal(values[1], "a".repeat(40)); return { rows: [], rowCount: 0 }; }
    if (sql.startsWith("SELECT * FROM merge_gate_checks")) return { rows: stored.has(Number(values[0])) ? [stored.get(Number(values[0]))] : [] };
    if (sql.startsWith("INSERT INTO merge_gate_checks")) stored.set(Number(values[0]), { check_run_id: Number(values[3]), decision_digest: String(values[4]) });
    if (sql.startsWith("INSERT INTO merge_gate_decisions")) decisions.push(values[4]);
    return { rows: [], rowCount: 0 };
  } } as unknown as import("pg").PoolClient;
  let failFirst = false;
  const github = {
    openPullRequests: async (_installationId: number, repositoryId: number) => {
      if (failFirst && repositoryId === 1) throw new Error("outage");
      return [{ number: 7, base: { ref: "main" }, head: { sha: "a".repeat(40), repo: { id: repositoryId } } }];
    },
    publishMergeGate: async (_installationId: number, repositoryId: number, body: Record<string, unknown>) => {
      calls.push({ repositoryId, body }); return { id: 70 + repositoryId };
    },
  } as unknown as import("./github/client").GitHubClient;
  await refreshMergeGates(db, github);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.head_sha, "a".repeat(40));
  assert.equal(calls[0].body.conclusion, "failure");
  assert.equal(decisions.length, 2);
  await refreshMergeGates(db, github);
  assert.equal(calls.length, 2);
  stored.delete(2); failFirst = true;
  await refreshMergeGates(db, github);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].repositoryId, 2);
});
