import test from "node:test";
import assert from "node:assert/strict";
import { systemConfidenceKey, systemEnvironmentSchema, systemProviderSchema, systemRunSchema, toSystemConfidenceState } from "./system-tests";

test("system confidence keys retain provider environment and suite identity", () => {
  assert.equal(systemConfidenceKey("hil","rig-a","smoke"), "system:hil:environment:rig-a:suite:smoke");
});

test("provider and virtual/hardware environment contracts validate", () => {
  assert.equal(systemProviderSchema.parse({ repositoryId: 1, providerKey: "lab", adapterKey: "rest-v1" }).providerKey, "lab");
  assert.equal(systemEnvironmentSchema.parse({ repositoryId: 1, providerKey: "lab", environmentKey: "sim", environmentType: "virtual" }).environmentType, "virtual");
  assert.equal(systemEnvironmentSchema.parse({ repositoryId: 1, providerKey: "lab", environmentKey: "rig", environmentType: "hardware" }).environmentType, "hardware");
});

test("only passed system runs can pass Level 3 evidence", () => {
  assert.equal(toSystemConfidenceState("passed"), "passed");
  assert.equal(toSystemConfidenceState("queued"), "pending");
  assert.equal(toSystemConfidenceState("running"), "running");
  for (const state of ["failed","timed_out","canceled","incomplete"] as const) assert.equal(toSystemConfidenceState(state), "failed");
});

test("retry attempts and exact artifact identity are required by normalized run contract", () => {
  const run = systemRunSchema.parse({ artifactId: 9, providerKey: "hil", environmentKey: "rig-a", suiteKey: "regression", providerRunId: "abc", attempt: 2, state: "passed", observedAt: "2026-09-08T19:00:00Z" });
  assert.equal(run.artifactId, 9);
  assert.equal(run.attempt, 2);
});
