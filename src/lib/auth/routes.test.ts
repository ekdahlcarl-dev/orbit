import assert from "node:assert/strict";
import test from "node:test";

// Import real route handlers; no GitHub/database connection is needed to reject
// an anonymous caller, even when the requested resource ID is otherwise valid.
test("all protected API routes reject anonymous requests before resource access", async () => {
  const routes = [
    [await import("../../app/api/confidence/[operation]/route"), "history", "artifactId=1"],
    [await import("../../app/api/component-tests/[operation]/route"), "results", "artifactId=1"],
    [await import("../../app/api/system-tests/[operation]/route"), "runs", "artifactId=1"],
    [await import("../../app/api/static-analysis/[operation]/route"), "level-1", "buildRunId=1"],
    [await import("../../app/api/builds/[operation]/route"), "runs", "installationId=10"],
    [await import("../../app/api/github/[operation]/route"), "audit", "installationId=10"],
  ] as const;
  for (const [route, operation, query] of routes) {
    const context = { params: Promise.resolve({ operation }) };
    const response = await route.GET(new Request(`https://orbit.test/api/test?${query}`), context);
    assert.equal(response.status, 401, operation);
    const mutation = await route.POST(new Request("https://orbit.test/api/test", { method: "POST", body: "invalid json" }), context);
    assert.equal(mutation.status, 401, operation);
  }
  for (const [handler, query] of [
    [(await import("../../app/api/dashboard/route")).GET, "repositoryId=1"],
    [(await import("../../app/api/risk/route")).GET, "repositoryId=1"],
    [(await import("../../app/api/recommendations/route")).GET, "repositoryId=1"],
    [(await import("../../app/api/github/grants/route")).GET, ""],
    [(await import("../../app/api/auth/audit/route")).GET, ""],
    [(await import("../../app/api/telemetry/route")).GET, ""],
    [(await import("../../app/api/auth/me/route")).GET, ""],
  ] as const) assert.equal((await handler(new Request(`https://orbit.test/api/test?${query}`))).status, 401);
  for (const handler of [
    (await import("../../app/api/evidence/[operation]/route")).POST,
    (await import("../../app/api/assistant/route")).POST,
    (await import("../../app/api/recommendations/route")).POST,
    (await import("../../app/api/github/grants/route")).POST,
  ]) assert.equal((await handler(new Request("https://orbit.test/api/test", { method: "POST", body: "invalid json" }), { params: Promise.resolve({ operation: "ingest" }) })).status, 401);
});
