import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../../app/api/github/[operation]/route";

test("every admin API authenticates before GitHub/database access", async () => {
  const previousUser = process.env.ORBIT_OPERATOR_USER;
  const previousPassword = process.env.ORBIT_OPERATOR_PASSWORD;
  process.env.ORBIT_OPERATOR_USER = "operator";
  process.env.ORBIT_OPERATOR_PASSWORD = "x".repeat(32);
  try {
    for (const operation of ["installations", "repositories", "options", "configurations", "audit"]) {
      const response = await GET(new Request(`https://orbit.test/api/github/${operation}`), { params: Promise.resolve({ operation }) });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const response = await POST(new Request("https://orbit.test/api/github/configurations", { method: "POST", body: "not json" }), { params: Promise.resolve({ operation: "configurations" }) });
    assert.equal(response.status, 401);
  } finally {
    if (previousUser === undefined) delete process.env.ORBIT_OPERATOR_USER; else process.env.ORBIT_OPERATOR_USER = previousUser;
    if (previousPassword === undefined) delete process.env.ORBIT_OPERATOR_PASSWORD; else process.env.ORBIT_OPERATOR_PASSWORD = previousPassword;
  }
});
