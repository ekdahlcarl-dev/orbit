import assert from "node:assert/strict";
import test from "node:test";
import { randomInt } from "node:crypto";
import pg from "pg";
import { authorizeIdentity, repositoryForResource } from "./rbac";

/** Run with DATABASE_URL set. Transaction rollback leaves no permanent test grants. */
test("PostgreSQL RBAC: identity roles and repository isolation", { skip: !process.env.DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  try {
    const viewer = 8_000_000_000_000 + randomInt(1_000_000);
    const owner = viewer + 1_000_000;
    const admin = viewer + 2_000_000;
    const repoA = viewer + 3_000_000;
    const repoB = viewer + 4_000_000;
    await client.query("INSERT INTO orbit_user_roles(github_user_id,role) VALUES($1,'viewer'),($2,'product_owner'),($3,'admin')", [viewer,owner,admin]);
    await client.query("INSERT INTO orbit_repository_grants(github_user_id,repository_id) VALUES($1,$3),($2,$3),($3,$4)", [viewer,owner,repoA,admin,repoB]);
    assert.equal(await authorizeIdentity(client, viewer, "read", repoA), "viewer");
    await assert.rejects(authorizeIdentity(client, viewer, "recommendation_decide", repoA), { status: 403 });
    await assert.rejects(authorizeIdentity(client, viewer, "read", repoB), { status: 403 });
    assert.equal(await authorizeIdentity(client, owner, "recommendation_decide", repoA), "product_owner");
    await assert.rejects(authorizeIdentity(client, owner, "configuration_write", repoA), { status: 403 });
    await assert.rejects(authorizeIdentity(client, owner, "read", repoB), { status: 403 });
    assert.equal(await authorizeIdentity(client, admin, "configuration_write", repoB), "admin");
    await assert.rejects(authorizeIdentity(client, admin, "configuration_write", repoA), { status: 403 });
    await assert.rejects(authorizeIdentity(client, admin + 1, "read"), { status: 403 });
    await assert.rejects(authorizeIdentity(client, admin, "read", 0), { status: 400 });
    await assert.rejects(repositoryForResource(client, "artifact", 0), { status: 400 });
    await assert.rejects(repositoryForResource(client, "build", 0), { status: 400 });
    await assert.rejects(repositoryForResource(client, "action", 0), { status: 400 });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
