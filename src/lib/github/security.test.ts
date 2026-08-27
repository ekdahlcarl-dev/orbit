import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { allowedInstallations, appJwt, configurationSchema, readLimitedBody, requireInstallation, requireOperator, verifySignature } from "./security";

const env = { ORBIT_OPERATOR_USER: "operator", ORBIT_OPERATOR_PASSWORD: "x".repeat(32), GITHUB_ALLOWED_INSTALLATION_IDS: "10,20", GITHUB_WEBHOOK_SECRET: "s".repeat(32) };
const authorization = `Basic ${Buffer.from(`operator:${env.ORBIT_OPERATOR_PASSWORD}`).toString("base64")}`;

test("operator boundary rejects anonymous, bad credentials, missing setup and cross-origin requests", () => {
  assert.throws(() => requireOperator(new Request("https://orbit.test"), env), /credentials/);
  assert.throws(() => requireOperator(new Request("https://orbit.test", { headers: { authorization: "Basic wrong" } }), env), /credentials/);
  assert.throws(() => requireOperator(new Request("https://orbit.test"), {}), /not configured/);
  assert.throws(() => requireOperator(new Request("https://orbit.test", { headers: { authorization, origin: "https://evil.test" } }), env), /Cross-origin/);
  assert.equal(requireOperator(new Request("https://orbit.test", { headers: { authorization, origin: "https://orbit.test" } }), env), "operator");
});

test("installation authorization fails closed and validates IDs", () => {
  assert.deepEqual(allowedInstallations(env), [10, 20]);
  assert.throws(() => allowedInstallations({}), /not configured/);
  assert.throws(() => allowedInstallations({ GITHUB_ALLOWED_INSTALLATION_IDS: "garbage" }), /not configured/);
  assert.throws(() => requireInstallation(30, env), /not authorized/);
  assert.throws(() => configurationSchema.parse({ installationId: 1, repositoryId: 2, ref: "heads/main", workflowId: 3, enabled: true, token: "bad" }));
});

test("JWT has short validity, RS256 signature and correct app identity", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = appJwt({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, 1000);
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iat: 940, exp: 1540, iss: "123" });
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
});

test("webhook HMAC uses exact bytes, rejecting tampering and malformed signatures", () => {
  const body = Buffer.from('{"message":"hello 🌍"}');
  const signature = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;
  verifySignature(body, signature, env);
  assert.throws(() => verifySignature(Buffer.concat([body, Buffer.from(" ")]), signature, env), /Invalid/);
  for (const bad of [null, "sha1=123", "sha256=zz", "sha256=" + "0".repeat(64)]) assert.throws(() => verifySignature(body, bad, env), /Invalid/);
});

test("body limit is enforced with and without content-length", async () => {
  assert.equal((await readLimitedBody(new Request("https://orbit.test", { method: "POST", body: "abc" }), 3)).toString(), "abc");
  await assert.rejects(() => readLimitedBody(new Request("https://orbit.test", { method: "POST", body: "abcd" }), 3), /too large/);
  await assert.rejects(() => readLimitedBody(new Request("https://orbit.test", { method: "POST", body: "a", headers: { "content-length": "100" } }), 3), /too large/);
});
