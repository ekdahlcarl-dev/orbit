import test from "node:test";
import assert from "node:assert/strict";
import { blockingStage, githubRunUrl } from "./dashboard";

test("blocking stage identifies first non-passing confidence stage", () => {
  assert.deepEqual(blockingStage({ confidence_level: 0, level_1_state: "failed", level_2_state: "blocked", level_3_state: "blocked" }), { level: 1, state: "failed" });
  assert.deepEqual(blockingStage({ confidence_level: 1, level_1_state: "passed", level_2_state: "stale", level_3_state: "blocked" }), { level: 2, state: "stale" });
  assert.deepEqual(blockingStage({ confidence_level: 2, level_1_state: "passed", level_2_state: "passed", level_3_state: "pending" }), { level: 3, state: "pending" });
  assert.equal(blockingStage({ confidence_level: 3, level_1_state: "passed", level_2_state: "passed", level_3_state: "passed" }), null);
});

test("GitHub workflow links are deterministic and absent without a run", () => {
  assert.equal(githubRunUrl("owner/repo", 123), "https://github.com/owner/repo/actions/runs/123");
  assert.equal(githubRunUrl("owner/repo", null), null);
});
