import { test } from "node:test";
import assert from "node:assert/strict";
import { digest, parseCookie } from "./store";

test("session and OAuth state digests do not expose bearer values", () => {
  const value = "sensitive-token";
  assert.match(digest(value), /^[a-f0-9]{64}$/);
  assert.notEqual(digest(value), value);
  assert.equal(digest(value), digest(value));
});
test("cookie parser extracts exact name and does not accept prefix collisions", () => {
  assert.equal(parseCookie("orbit_session_extra=bad; orbit_session=good", "orbit_session"), "good");
  assert.equal(parseCookie("orbit_session_extra=bad", "orbit_session"), undefined);
  assert.equal(parseCookie(null, "orbit_session"), undefined);
});
