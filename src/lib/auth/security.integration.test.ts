import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomInt } from "node:crypto";
import { getDb } from "../db";
import { digest, getSession } from "./store";
import { GET as start } from "../../app/api/auth/github/start/route";
import { GET as callback } from "../../app/api/auth/github/callback/route";
import { POST as logout } from "../../app/api/auth/logout/route";
import { GET as audit } from "../../app/api/auth/audit/route";
import { POST as build } from "../../app/api/builds/[operation]/route";
import { POST as configure } from "../../app/api/static-analysis/[operation]/route";
import { GET as dashboard } from "../../app/api/dashboard/route";

const enabled = Boolean(process.env.DATABASE_URL);
after(async () => { if (enabled) await getDb().end(); });

test("PostgreSQL and route security: OAuth, sessions, role/repository boundaries and immutable audit", { skip: !enabled }, async () => {
  const db = getDb();
  const user = 6_000_000_000_000 + randomInt(1_000_000);
  const repo = user + 1_000_000;
  const prior = { ...process.env };
  const originalFetch = globalThis.fetch;
  let token: string | undefined;
  const publicUrl = "https://orbit.test";
  const make = (path: string, body?: unknown, origin = publicUrl) => new Request(publicUrl + path, {
    method: body ? "POST" : "GET",
    headers: { cookie: `orbit_session=${token}`, origin },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    process.env.ORBIT_PUBLIC_URL = publicUrl;
    process.env.ORBIT_AUTH_SECRET = "test-only-auth-secret-".repeat(3);
    process.env.GITHUB_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-client-secret";
    process.env.GITHUB_ALLOWED_INSTALLATION_IDS = "10";
    const started = await start();
    assert.equal(started.status, 307);
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const cookies = started.headers.get("set-cookie")!;
    assert.ok(cookies.includes(state));
    assert.match(cookies, /HttpOnly/i);
    assert.match(cookies, /Secure/i);
    assert.match(cookies, /SameSite=lax/i);
    let exchanges = 0;
    globalThis.fetch = async input => {
      exchanges++;
      return Response.json(String(input).includes("access_token") ? { access_token: "test-only-token" } : { id: user, login: "security-test" });
    };
    const callbackRequest = () => new Request(`${publicUrl}/api/auth/github/callback?code=test-code&state=${state}`, { headers: { cookie: `orbit_oauth_state=${state}` } });
    const signedIn = await callback(callbackRequest());
    assert.equal(signedIn.status, 307);
    assert.equal(new URL(signedIn.headers.get("location")!).pathname, "/dashboard");
    token = /orbit_session=([A-Za-z0-9_-]{43})/.exec(signedIn.headers.get("set-cookie")!)?.[1];
    assert.ok(token);
    assert.equal(exchanges, 2);
    assert.equal((await callback(callbackRequest())).status, 401);
    assert.equal(exchanges, 2, "replayed state cannot exchange a token");
    assert.deepEqual(await getSession(token), { id: user, login: "security-test" });
    assert.equal((await audit(make("/api/auth/audit"))).status, 403, "new identities have no implicit role");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('orbit.actor', 'test:provisioner', true)");
      await client.query("INSERT INTO orbit_user_roles(github_user_id,role) VALUES($1,'viewer')", [user]);
      await client.query("INSERT INTO orbit_repository_grants(github_user_id,repository_id) VALUES($1,$2)", [user, repo]);
      await client.query("COMMIT");
    } finally { client.release(); }
    const context = { params: Promise.resolve({ operation: "manual" }) };
    assert.equal((await build(make("/api/builds/manual", { installationId: 10, repositoryId: repo }), context)).status, 403);
    await db.query("UPDATE orbit_user_roles SET role='product_owner' WHERE github_user_id=$1", [user]);
    assert.equal((await build(make("/api/builds/manual", { installationId: 10, repositoryId: repo }), context)).status, 403);
    await db.query("UPDATE orbit_user_roles SET role='admin' WHERE github_user_id=$1", [user]);
    assert.equal((await build(make("/api/builds/manual", { installationId: 10, repositoryId: repo + 1 }), context)).status, 403);
    assert.equal((await build(make("/api/builds/manual", { installationId: 10, repositoryId: repo }, "https://evil.test"), context)).status, 403);
    assert.equal((await dashboard(make(`/api/dashboard?repositoryId=${repo + 1}`))).status, 403);
    const configured = await configure(make("/api/static-analysis/configure", { repositoryId: repo, provider: "security-test" }), { params: Promise.resolve({ operation: "configure" }) });
    assert.equal(configured.status, 201);
    const configuredAudit = await db.query("SELECT actor,github_user_id FROM security_audit WHERE repository_id=$1 AND action='static_analysis_requirements.insert'", [repo]);
    assert.equal(configuredAudit.rows[0].actor, `github:${user}:security-test`);
    assert.equal(Number(configuredAudit.rows[0].github_user_id), user);
    const history = await audit(make("/api/auth/audit"));
    assert.equal(history.status, 200);
    assert.equal(history.headers.get("cache-control"), "no-store");
    const rows = await history.json() as Array<{ actor: string; action: string; github_user_id: string }>;
    assert.ok(rows.some(r => r.actor === "test:provisioner" && r.action === "orbit_repository_grants.insert" && Number(r.github_user_id) === user));
    assert.ok(!JSON.stringify(rows).includes(token!));
    await assert.rejects(db.query("DELETE FROM security_audit WHERE github_user_id=$1", [user]), /append-only/);
    assert.equal((await logout(make("/api/auth/logout", {}))).status, 200);
    assert.equal(await getSession(token), null);
    assert.equal((await audit(make("/api/auth/audit"))).status, 401);
    const sessionAudit = await db.query("SELECT before_value,after_value FROM security_audit WHERE github_user_id=$1 AND action LIKE 'orbit_auth_sessions.%'", [user]);
    assert.ok(sessionAudit.rowCount! >= 2);
    assert.ok(!JSON.stringify(sessionAudit.rows).includes(digest(token!)), "audit excludes session hashes as well as tokens");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ["ORBIT_PUBLIC_URL", "ORBIT_AUTH_SECRET", "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_ALLOWED_INSTALLATION_IDS"]) {
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
    await db.query("DELETE FROM static_analysis_requirements WHERE repository_id=$1", [repo]);
    await db.query("DELETE FROM orbit_auth_sessions WHERE github_user_id=$1", [user]);
    await db.query("DELETE FROM orbit_user_roles WHERE github_user_id=$1", [user]);
  }
});
