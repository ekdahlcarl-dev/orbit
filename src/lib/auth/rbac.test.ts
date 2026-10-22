import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRepository, authorizeRole, canPerform } from "./rbac";

test("viewer is read-only", () => {
  assert.equal(canPerform("viewer", "read"), true);
  for (const action of ["recommendation_decide", "build_trigger", "configuration_write", "user_admin"] as const) {
    assert.equal(canPerform("viewer", action), false);
    assert.throws(() => authorizeRole("viewer", action), { status: 403 });
  }
});

test("product owner can decide recommendations but not administer", () => {
  assert.doesNotThrow(() => authorizeRole("product_owner", "recommendation_decide"));
  assert.throws(() => authorizeRole("product_owner", "build_trigger"), { status: 403 });
  assert.throws(() => authorizeRole("product_owner", "configuration_write"), { status: 403 });
});

test("admin permissions are explicit, not inferred from authentication", () => {
  assert.throws(() => authorizeRole(null, "read"), { status: 403 });
  assert.doesNotThrow(() => authorizeRole("admin", "user_admin"));
});

test("repository grants are deny by default", () => {
  assert.throws(() => authorizeRepository(false), { status: 403 });
  assert.doesNotThrow(() => authorizeRepository(true));
});
