import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { receiveWebhook } from "./webhooks";

test("PostgreSQL webhook retries serialize, conflicts fail, and audit failure rolls back", { skip: !process.env.DATABASE_URL }, async () => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const repositoryId = 7_000_000_000_000 + randomInt(1_000_000);
  const secret = "test-only-webhook-secret-".repeat(3);
  const env = { GITHUB_WEBHOOK_SECRET: secret, GITHUB_ALLOWED_INSTALLATION_IDS: "10" };
  const delivery = randomUUID(), rollbackDelivery = randomUUID();
  function request(id: string, sender = 1, event = "push", repo = repositoryId) {
    const body = JSON.stringify({ installation: { id: 10 }, repository: { id: repo }, sender: { id: sender }, ref: "refs/heads/main" });
    return new Request("https://orbit.test/api/github/webhook", { method: "POST", body, headers: {
      "x-github-delivery": id, "x-github-event": event,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    } });
  }
  try {
    await db.query("INSERT INTO github_repositories(repository_id,installation_id,full_name,default_ref,workflow_id,workflow_path) VALUES($1,10,'test/security','heads/main',1,'.github/workflows/test.yml')", [repositoryId]);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => receiveWebhook(db, request(delivery), env)));
    assert.equal(outcomes.filter(o => "accepted" in o).length, 1);
    assert.equal(outcomes.filter(o => "duplicate" in o).length, 7);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM job_queue WHERE payload->>'deliveryId'=$1", [delivery])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM github_audit WHERE after_value->>'deliveryId'=$1", [delivery])).rows[0].n, 1);
    await assert.rejects(receiveWebhook(db, request(delivery, 2), env), { status: 409 });
    await assert.rejects(receiveWebhook(db, request(delivery, 1, "issues"), env), { status: 409 });
    await assert.rejects(receiveWebhook(db, request(randomUUID(), 1, "push", repositoryId + 1), env), { status: 403 });
    // Real transaction writes, with a simulated audit outage after delivery/job inserts.
    const failing = { async connect() {
      const client = await db.connect();
      return { release: () => client.release(), query: (sql: string, args?: unknown[]) => {
        if (sql.includes("INSERT INTO github_audit")) throw new Error("simulated audit outage");
        return client.query(sql, args);
      } };
    } } as unknown as Pool;
    await assert.rejects(receiveWebhook(failing, request(rollbackDelivery), env), /audit outage/);
    assert.equal((await db.query("SELECT 1 FROM github_deliveries WHERE delivery_id=$1", [rollbackDelivery])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM job_queue WHERE payload->>'deliveryId'=$1", [rollbackDelivery])).rowCount, 0);
    assert.deepEqual(await receiveWebhook(db, request(rollbackDelivery), env), { accepted: true });
  } finally {
    await db.query("DELETE FROM job_queue WHERE payload->>'deliveryId'=ANY($1::text[])", [[delivery, rollbackDelivery]]);
    await db.query("DELETE FROM github_deliveries WHERE delivery_id=ANY($1::text[])", [[delivery, rollbackDelivery]]);
    await db.query("DELETE FROM github_audit WHERE repository_id=$1", [repositoryId]);
    await db.query("DELETE FROM github_repositories WHERE repository_id=$1", [repositoryId]);
    await db.end();
  }
});
