import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { canonicalJson, receiveWebhook } from "./webhooks";

const secret = "s".repeat(40);
const env = { GITHUB_WEBHOOK_SECRET: secret, GITHUB_ALLOWED_INSTALLATION_IDS: "10" };
const base = { installation: { id: 10 }, repository: { id: 20 }, ref: "refs/heads/main" };

function request(payload: unknown, delivery = "delivery-1", event = "push", signed = true) {
  const body = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://orbit.test/api/github/webhook", {
    method: "POST", body,
    headers: { "x-github-event": event, "x-github-delivery": delivery, "x-hub-signature-256": signed ? signature : "sha256=" + "0".repeat(64) },
  });
}

function mockDatabase() {
  const deliveries = new Map<string, { event: string; installation_id: number | null; repository_id: number | null; payload: unknown; payload_fingerprint: unknown }>();
  const audit: unknown[] = [];
  const queue: unknown[] = [];
  const client = {
    async query(sql: string, args: unknown[] = []) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT 1 FROM github_repositories")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("INSERT INTO github_deliveries")) {
        const id = String(args[0]);
        if (deliveries.has(id)) return { rows: [], rowCount: 0 };
        deliveries.set(id, { event: String(args[1]), installation_id: args[2] === null ? null : Number(args[2]), repository_id: args[3] === null ? null : Number(args[3]), payload: args[4], payload_fingerprint: args[6] });
        return { rows: [{ delivery_id: id }], rowCount: 1 };
      }
      if (sql.includes("SELECT event,installation_id,repository_id,payload,payload_fingerprint FROM github_deliveries")) {
        const item = deliveries.get(String(args[0]));
        return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO job_queue")) { queue.push(args[0]); return { rows: [], rowCount: 1 }; }
      if (sql.includes("INSERT INTO github_audit")) { audit.push(args); return { rows: [], rowCount: 1 }; }
      throw new Error("Unexpected SQL: " + sql);
    },
    release() {},
  };
  return { db: { async connect() { return client; } } as unknown as Pool, deliveries, audit, queue };
}

test("canonical payload comparison ignores JSON object key ordering", () => {
  assert.equal(canonicalJson({ b: 2, a: { z: 1, y: 3 } }), canonicalJson({ a: { y: 3, z: 1 }, b: 2 }));
});

test("valid retry is idempotent and does not enqueue or audit twice", async () => {
  const { db, queue, audit } = mockDatabase();
  assert.deepEqual(await receiveWebhook(db, request(base), env), { accepted: true });
  assert.deepEqual(await receiveWebhook(db, request({ ref: base.ref, repository: base.repository, installation: base.installation }), env), { duplicate: true });
  assert.equal(queue.length, 1);
  assert.equal(audit.length, 1);
});

test("reused delivery ID with changed signed payload is rejected", async () => {
  const { db, queue, audit } = mockDatabase();
  await receiveWebhook(db, request(base), env);
  await assert.rejects(() => receiveWebhook(db, request({ ...base, ref: "refs/heads/other" }), env), { status: 409 });
  assert.equal(queue.length, 1);
  assert.equal(audit.length, 1);
});

test("bad signature and invalid installation fail before database writes", async () => {
  const { db, queue, audit } = mockDatabase();
  await assert.rejects(() => receiveWebhook(db, request(base, "delivery-1", "push", false), env), { status: 401 });
  await assert.rejects(() => receiveWebhook(db, request({ ...base, installation: { id: 999 } }), env), { status: 403 });
  assert.equal(queue.length, 0);
  assert.equal(audit.length, 0);
});

test("conflicting signed fields outside the processing schema are rejected", async () => {
  const { db } = mockDatabase();
  await receiveWebhook(db, request({ ...base, sender: { id: 1 } }), env);
  await assert.rejects(() => receiveWebhook(db, request({ ...base, sender: { id: 2 } }), env), { status: 409 });
});
test("ping and ignored events are authorized, audited and replay protected without jobs", async () => {
  for (const event of ["ping", "issues"]) {
    const { db, queue, audit } = mockDatabase();
    await receiveWebhook(db, request(base, "delivery-1", event), env);
    assert.deepEqual(await receiveWebhook(db, request(base, "delivery-1", event), env), { duplicate: true });
    await assert.rejects(() => receiveWebhook(db, request({ ...base, after: "changed" }, "delivery-1", event), env), { status: 409 });
    await assert.rejects(() => receiveWebhook(db, request({ installation: { id: 999 } }, "delivery-2", event), env), { status: 403 });
    assert.equal(queue.length, 0);
    assert.equal(audit.length, 1);
  }
});

test("app-level ping without installation requires signed matching app identity", async () => {
  const { db, queue, audit } = mockDatabase();
  const configured = { ...env, GITHUB_APP_ID: "123" };
  assert.deepEqual(await receiveWebhook(db, request({ hook: { app_id: 123 }, zen: "hello" }, "app-ping", "ping"), configured), { ping: true });
  assert.deepEqual(await receiveWebhook(db, request({ hook: { app_id: 123 }, zen: "hello" }, "app-ping", "ping"), configured), { duplicate: true });
  await assert.rejects(receiveWebhook(db, request({ hook: { app_id: 999 } }, "bad-ping", "ping"), configured), { status: 403 });
  await assert.rejects(receiveWebhook(db, request({ zen: "no identity" }, "bad-ping", "ping"), configured), { status: 403 });
  assert.equal(queue.length, 0);
  assert.equal(audit.length, 1);
});
