import { test } from "node:test";
import assert from "node:assert/strict";
import { issueSession, readSession, sessionCookie, clearSessionCookie } from "./session";

const secret = "s".repeat(48);
const user = { id: 123, login: "developer" };
test("session verifies correct identity and rejects tampering, expiry and wrong secret", () => {
  const token = issueSession(user, secret, 1000);
  assert.deepEqual(readSession(token, secret, 1001)?.user, user);
  assert.equal(readSession(token + "x", secret, 1001), null);
  assert.equal(readSession(token, "x".repeat(48), 1001), null);
  assert.equal(readSession(token, secret, 1000 + 8 * 60 * 60 * 1000), null);
  assert.equal(readSession(undefined, secret), null);
});
test("session cookies are HttpOnly, Secure, SameSite and removable", () => {
  assert.match(sessionCookie("token"), /HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
  assert.match(clearSessionCookie(), /Max-Age=0; Secure/);
});
