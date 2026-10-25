import { test } from "node:test";
import assert from "node:assert/strict";
import { createOAuthState, verifyOAuthState, githubAuthorizeUrl, parseGithubIdentity } from "./oauth";

const secret = "a".repeat(48);
test("OAuth state verifies once within expiry window and rejects tampering", () => {
  const state = createOAuthState(secret, 1000);
  assert.ok(verifyOAuthState(state, secret, 1001));
  assert.equal(verifyOAuthState(state, secret, 601001), null);
  assert.equal(verifyOAuthState(state + "x", secret, 1001), null);
  assert.equal(verifyOAuthState(state, "b".repeat(48), 1001), null);
  assert.equal(verifyOAuthState("invalid", secret, 1001), null);
  assert.equal(verifyOAuthState("x".repeat(100_000), secret, 1001), null);
});
test("OAuth state requires a strong secret", () => {
  assert.throws(() => createOAuthState("weak"), /secret/);
});
test("authorize URL includes state and exact redirect URI without extra scopes", () => {
  const url = new URL(githubAuthorizeUrl("client-id", "https://orbit.example/api/auth/github/callback", "state-value"));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("redirect_uri"), "https://orbit.example/api/auth/github/callback");
  assert.equal(url.searchParams.has("scope"), false);
});
test("GitHub identity validation rejects invalid IDs and logins", () => {
  assert.deepEqual(parseGithubIdentity({ id: 42, login: "developer", name: "ignored" }), { id: 42, login: "developer" });
  for (const value of [null, {}, { id: -1, login: "x" }, { id: 1, login: "<script>" }]) {
    assert.throws(() => parseGithubIdentity(value), /Invalid/);
  }
});
