import { test } from "node:test";
import assert from "node:assert/strict";
import { determineLevel1, mapSonarState, sonarAdapter } from "./static-analysis";

test("maps Sonar quality gate states", () => {
  assert.equal(mapSonarState("OK"), "passed");
  assert.equal(mapSonarState("ERROR"), "failed");
  assert.equal(mapSonarState("PENDING"), "pending");
  assert.equal(mapSonarState("IN_PROGRESS"), "running");
});

test("determines Level 1 deterministically from mandatory gates", () => {
  assert.equal(determineLevel1([]), "not-configured");
  assert.equal(determineLevel1([null]), "pending");
  assert.equal(determineLevel1(["passed", "pending"]), "pending");
  assert.equal(determineLevel1(["passed", "running"]), "running");
  assert.equal(determineLevel1(["passed", "failed"]), "failed");
  assert.equal(determineLevel1(["passed", "passed"]), "passed");
});

test("Sonar adapter normalizes findings and provenance", () => {
  const result = sonarAdapter.normalize({
    buildRunId: 12,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    evidenceId: 44,
    qualityGateStatus: "ERROR",
    findings: { bugs: 2, vulnerabilities: 1, codeSmells: 8 },
    trend: { newBugs: 1, coverageDelta: -2.4 },
    projectKey: "orbit",
    analysisId: "analysis-123",
  });
  assert.equal(result.provider, "sonar");
  assert.equal(result.state, "failed");
  assert.equal(result.findings.bugs, 2);
  assert.equal(result.provenance.projectKey, "orbit");
});
