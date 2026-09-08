import { test } from "node:test";
import assert from "node:assert/strict";
import { determineConfidenceLevel, evaluateConfiguredLevel } from "./confidence";

const req = (key: string, maxAgeMinutes: number | null = null) => ({ key, required: true, maxAgeMinutes });
const obs = (key: string, state: "pending" | "running" | "passed" | "failed", observedAt = new Date("2026-09-08T10:00:00Z")) => ({ key, state, observedAt, evidenceId: 1 });

test("blocks higher level until lower level passes", () => {
  assert.equal(evaluateConfiguredLevel([req("component")], [obs("component", "passed")], false), "blocked");
});

test("missing and active evidence prevent promotion", () => {
  assert.equal(evaluateConfiguredLevel([req("component")], [], true), "pending");
  assert.equal(evaluateConfiguredLevel([req("component")], [obs("component", "running")], true), "running");
  assert.equal(evaluateConfiguredLevel([req("component")], [obs("component", "failed")], true), "failed");
});

test("stale evidence prevents promotion", () => {
  const now = new Date("2026-09-08T12:01:00Z");
  assert.equal(evaluateConfiguredLevel([req("component", 60)], [obs("component", "passed")], true, now), "stale");
});

test("all required fresh evidence passes", () => {
  const now = new Date("2026-09-08T10:30:00Z");
  assert.equal(evaluateConfiguredLevel([req("a", 60), req("b")], [obs("a", "passed"), obs("b", "passed")], true, now), "passed");
});

test("confidence promotion is cumulative", () => {
  assert.equal(determineConfidenceLevel("failed", "passed", "passed"), 0);
  assert.equal(determineConfidenceLevel("passed", "blocked", "passed"), 1);
  assert.equal(determineConfidenceLevel("passed", "passed", "pending"), 2);
  assert.equal(determineConfidenceLevel("passed", "passed", "passed"), 3);
});
