import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { GitHubClient } from "./client";
import { listConfigurations, saveConfiguration, transaction } from "./store";
import { processWebhook, receiveWebhook } from "./webhooks";
import { runWorkerIteration } from "../../worker/index";

// Use an isolated schema on a real PostgreSQL database; never truncate shared tables.
test("PostgreSQL: config audit, rollback, webhook deduplication, queue and revocation", { skip: !process.env.DATABASE_URL }, async () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `orb3_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await db.query(await readFile("db/migrations/001_init.sql", "utf8"));
    await db.query(await readFile("db/migrations/002_github_onboarding.sql", "utf8"));
    class StubGitHub extends GitHubClient {
      override async validate() { return { repository: { id: 5, name: "repo", full_name: "org/repo", default_branch: "main", archived: false }, workflow: { id: 7, name: "Build", path: ".github/workflows/build.yml", state: "active" }, refSha: "abc" }; }
    }
    const input = { installationId: 10, repositoryId: 5, workflowId: 7, ref: "heads/main", enabled: true };
    await saveConfiguration(db, new StubGitHub(), input, "operator");
    await saveConfiguration(db, new StubGitHub(), { ...input, enabled: false }, "operator");
    const history = await db.query("SELECT * FROM github_audit ORDER BY id");
    assert.equal(history.rows.length, 2);
    assert.equal(history.rows[0].before_value, null);
    assert.equal(history.rows[1].before_value.enabled, true);
    assert.equal(history.rows[1].after_value.enabled, false);
    assert.equal((await listConfigurations(db, 10, [])).length, 0);
    assert.equal((await listConfigurations(db, 20, [5])).length, 0);
    assert.equal((await listConfigurations(db, 10, [5])).length, 1);
    // A failed audit write must also roll back the configuration update.
    await assert.rejects(() => saveConfiguration(db, new StubGitHub(), { ...input, ref: "heads/other" }, null as unknown as string));
    assert.equal((await listConfigurations(db, 10, [5]))[0].default_ref, "heads/main");

    const env = { GITHUB_ALLOWED_INSTALLATION_IDS: "10", GITHUB_WEBHOOK_SECRET: "s".repeat(32) };
    const request = (event: string, delivery: string, data: unknown) => {
      const body = JSON.stringify(data);
      return new Request("https://orbit.test/api/github/webhook", { method: "POST", body, headers: {
        "x-github-event": event, "x-github-delivery": delivery,
        "x-hub-signature-256": `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`,
      } });
    };
    const payload = { action: "removed", installation: { id: 10 }, repositories_removed: [{ id: 5 }], secret: "discard-me" };
    const replies = await Promise.all(Array.from({ length: 4 }, () => receiveWebhook(db, request("installation_repositories", "delivery-1", payload), env)));
    assert.equal(replies.filter(r => "accepted" in r).length, 1);
    assert.equal((await db.query("SELECT * FROM job_queue")).rowCount, 1);
    assert.equal((await db.query("SELECT payload FROM github_deliveries")).rows[0].payload.secret, undefined);
    await runWorkerIteration(db);
    assert.equal((await db.query("SELECT status FROM job_queue")).rows[0].status, "succeeded");
    await transaction(db, client => processWebhook(client, "delivery-1"));
    const configured = (await listConfigurations(db, 10, [5]))[0];
    assert.equal(configured.access_status, "revoked");
    assert.equal(configured.enabled, false);
    assert.equal((await db.query("SELECT * FROM github_audit WHERE action='repository.access_revoked'")).rowCount, 1);
    await assert.rejects(() => receiveWebhook(db, request("push", "unauthorized", { installation: { id: 10 }, repository: { id: 999 } }), env), /not onboarded/);
    await assert.rejects(() => receiveWebhook(db, request("installation", "wrong-installation", { installation: { id: 11 } }), env), /not authorized/);
    assert.deepEqual(await receiveWebhook(db, request("ping", "setup-ping", { zen: "hello" }), env), { ping: true });
    await assert.rejects(() => receiveWebhook(db, request("push", "revoked", { installation: { id: 10 }, repository: { id: 5 } }), env), /not onboarded/);
    await db.query("INSERT INTO job_queue(job_type,payload) VALUES ('github.webhook',$1)", [{ deliveryId: "missing" }]);
    for (let attempt = 0; attempt < 3; attempt++) {
      await db.query("UPDATE job_queue SET available_at=now() WHERE status='queued'");
      await runWorkerIteration(db);
    }
    const failed = (await db.query("SELECT status,attempts FROM job_queue WHERE payload->>'deliveryId'='missing'")).rows[0];
    assert.deepEqual(failed, { status: "failed", attempts: 3 });
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
