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
  const token = "A".repeat(43);
  assert.equal(parseCookie(`orbit_session_extra=bad; orbit_session=${token}`, "orbit_session"), token);
  assert.equal(parseCookie("orbit_session_extra=bad", "orbit_session"), undefined);
  assert.equal(parseCookie(null, "orbit_session"), undefined);
});

test("session cookie parser rejects duplicates and malformed values", () => {
  const token = "A".repeat(43);
  const other = "B".repeat(43);
  assert.equal(parseCookie(`orbit_session=${token}; orbit_session=${other}`, "orbit_session"), undefined);
  assert.equal(parseCookie(`orbit_session=${token}; orbit_session=`, "orbit_session"), undefined);
  assert.equal(parseCookie("orbit_session=bad", "orbit_session"), undefined);
  assert.equal(parseCookie(`orbit_session=${token}%3B`, "orbit_session"), undefined);
  assert.equal(parseCookie(`orbit_session=${token}; other=${"X".repeat(8192)}`, "orbit_session"), undefined);
});
