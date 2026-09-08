import test from "node:test";
import assert from "node:assert/strict";
import { componentTestInputSchema, confidenceKey, summarizeComponentSuite, toConfidenceState } from "./component-tests";

test("normalizes a passing component suite", () => {
  const input = componentTestInputSchema.parse({
    artifactId: 1,
    evidenceId: 2,
    componentKey: "parser",
    suiteKey: "unit",
    observedAt: "2026-09-08T12:00:00Z",
    tests: [
      { name: "a", status: "passed" },
      { name: "b", status: "skipped" },
    ],
    coverage: { linesPct: 92.4, deltaPct: 1.2 },
  });
  assert.deepEqual(summarizeComponentSuite(input), {
    state: "passed",
    totals: { total: 2, passed: 1, failed: 0, error: 0, skipped: 1 },
    flakyTests: [],
  });
});

test("failed or error tests fail the suite", () => {
  const input = componentTestInputSchema.parse({
    artifactId: 1,
    evidenceId: 2,
    componentKey: "parser",
    suiteKey: "unit",
    observedAt: new Date(),
    tests: [{ name: "broken", status: "error" }],
  });
  assert.equal(summarizeComponentSuite(input).state, "failed");
});

test("flaky passing tests are unstable and cannot silently pass confidence", () => {
  const input = componentTestInputSchema.parse({
    artifactId: 1,
    evidenceId: 2,
    componentKey: "parser",
    suiteKey: "unit",
    observedAt: new Date(),
    tests: [{ name: "sometimes", status: "passed", flaky: true }],
  });
  const summary = summarizeComponentSuite(input);
  assert.equal(summary.state, "unstable");
  assert.deepEqual(summary.flakyTests, ["sometimes"]);
  assert.equal(toConfidenceState(summary.state), "failed");
});

test("pending and running suites retain execution state", () => {
  const base = { artifactId: 1, evidenceId: 2, componentKey: "api", suiteKey: "module", observedAt: new Date() };
  assert.equal(summarizeComponentSuite(componentTestInputSchema.parse({ ...base, executionState: "pending" })).state, "pending");
  assert.equal(summarizeComponentSuite(componentTestInputSchema.parse({ ...base, executionState: "running" })).state, "running");
});

test("component suite keys map deterministically into Level 2 requirements", () => {
  assert.equal(confidenceKey("parser", "unit"), "component:parser:suite:unit");
});
