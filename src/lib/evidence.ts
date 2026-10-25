import { createHash } from "node:crypto";
import { z } from "zod";
import { SaxesParser } from "saxes";
import type { Pool, PoolClient } from "pg";

type Database = Pool | PoolClient;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const artifactSchema = z.object({
  buildRunId: z.coerce.number().int().positive(),
  digestAlgorithm: z.literal("sha256").default("sha256"),
  digest: digestSchema,
  name: z.string().min(1).max(512),
  mediaType: z.string().max(255).optional(),
  sizeBytes: z.coerce.number().int().nonnegative().optional(),
  storageRef: z.string().min(1).max(2048).optional(),
}).strict();

const resultSchema = z.object({
  name: z.string().min(1).max(4096),
  status: z.enum(["passed","failed","error","skipped"]),
  durationMs: z.number().nonnegative().optional(),
  message: z.string().max(16384).optional(),
}).strict();

export const orbitJsonSchema = z.object({ schemaVersion: z.literal("1"), results: z.array(resultSchema).min(1).max(10000) }).strict();
export const evidenceSchema = z.object({
  buildRunId: z.coerce.number().int().positive(), artifactDigest: digestSchema.optional(),
  evidenceType: z.enum(["test","static_analysis","other"]), format: z.enum(["junit","orbit-json"]),
  source: z.string().min(1).max(512), rawStorageRef: z.string().min(1).max(2048), content: z.string().min(1).max(5_000_000),
  provenance: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
}).strict();
export type NormalizedResult = z.infer<typeof resultSchema>;

/** Validate XML structure before trusting test outcomes. Never resolve DTDs. */
export function normalizeJUnit(xml: string): NormalizedResult[] {
  if (Buffer.byteLength(xml, "utf8") > 5_000_000) throw new Error("JUnit report too large");
  const parser = new SaxesParser({ xmlns: false });
  const stack: string[] = [];
  const results: NormalizedResult[] = [];
  let current: NormalizedResult | undefined;
  parser.on("doctype", () => { throw new Error("JUnit DTDs are prohibited"); });
  parser.on("opentag", node => {
    const parent = stack.at(-1);
    if (!parent && !["testsuites", "testsuite", "testcase"].includes(node.name)) throw new Error("Invalid JUnit root");
    if (stack.length >= 64) throw new Error("JUnit nesting limit exceeded");
    if (node.name === "testcase") {
      if (current || (parent && parent !== "testsuite")) throw new Error("Invalid JUnit testcase structure");
      const name = node.attributes.name;
      if (!name || name.length > 4096) throw new Error("Invalid JUnit XML: testcase name is required or too long");
      const seconds = Number(node.attributes.time ?? "0");
      if (!Number.isFinite(seconds * 1000) || seconds < 0) throw new Error("Invalid JUnit XML: testcase time");
      if (results.length >= 10000) throw new Error("JUnit testcase limit exceeded");
      current = { name, status: "passed", durationMs: seconds * 1000 };
    }
    if (["failure", "error", "skipped"].includes(node.name)) {
      if (!current || parent !== "testcase") throw new Error("Invalid JUnit outcome structure");
      if (node.name === "error") current.status = "error";
      else if (node.name === "failure" && current.status !== "error") current.status = "failed";
      else if (node.name === "skipped" && current.status === "passed") current.status = "skipped";
      if (node.attributes.message) current.message = node.attributes.message.slice(0, 16384);
    }
    stack.push(node.name);
  });
  parser.on("closetag", node => {
    if (node.name === "testcase" && current) { results.push(current); current = undefined; }
    stack.pop();
  });
  parser.write(xml).close();
  if (!results.length) throw new Error("Invalid JUnit XML: no testcases");
  return results;
}

export function normalizeEvidence(format: "junit" | "orbit-json", content: string): NormalizedResult[] { if (format === "junit") return normalizeJUnit(content); return orbitJsonSchema.parse(JSON.parse(content)).results; }
function summary(results: NormalizedResult[]) { const counts = { passed: 0, failed: 0, error: 0, skipped: 0 }; for (const result of results) counts[result.status]++; const status = counts.error ? "error" : counts.failed ? "failed" : counts.passed ? "passed" : "skipped"; return { status, summary: { total: results.length, ...counts, results } } as const; }

export async function registerArtifact(db: Database, raw: unknown) {
  const input = artifactSchema.parse(raw);
  const run = await db.query("SELECT id,repository_id,commit_sha FROM build_runs WHERE id=$1", [input.buildRunId]);
  if (!run.rowCount) throw new Error("BuildRun does not exist"); const lineage = run.rows[0];
  const existing = await db.query("SELECT * FROM artifacts WHERE digest_algorithm=$1 AND digest=$2", [input.digestAlgorithm,input.digest]);
  if (existing.rowCount) { const item = existing.rows[0]; if (Number(item.build_run_id) !== input.buildRunId || Number(item.repository_id) !== Number(lineage.repository_id) || item.commit_sha !== lineage.commit_sha) throw new Error("Artifact digest already exists with different lineage"); return item; }
  return (await db.query(`INSERT INTO artifacts(digest_algorithm,digest,name,media_type,size_bytes,build_run_id,repository_id,commit_sha,storage_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [input.digestAlgorithm,input.digest,input.name,input.mediaType??null,input.sizeBytes??null,input.buildRunId,lineage.repository_id,lineage.commit_sha,input.storageRef??null])).rows[0];
}

async function quarantine(db: Database, input: { buildRunId?: number; artifactDigest?: string; source: string; rawStorageRef?: string }, reason: string) { await db.query("INSERT INTO evidence_quarantine(build_run_id,artifact_digest,source,reason,raw_storage_ref) VALUES($1,$2,$3,$4,$5)", [input.buildRunId??null,input.artifactDigest??null,input.source,reason,input.rawStorageRef??null]); }
function quarantineMetadata(raw: unknown) { const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}; const buildRunId = typeof value.buildRunId === "number" && Number.isInteger(value.buildRunId) && value.buildRunId > 0 ? value.buildRunId : undefined; const artifactDigest = typeof value.artifactDigest === "string" ? value.artifactDigest.slice(0, 512) : undefined; const source = typeof value.source === "string" && value.source.length > 0 ? value.source.slice(0, 512) : "unknown"; const rawStorageRef = typeof value.rawStorageRef === "string" && value.rawStorageRef.length > 0 ? value.rawStorageRef.slice(0, 2048) : undefined; return { buildRunId, artifactDigest, source, rawStorageRef }; }

export async function ingestEvidence(db: Database, raw: unknown) {
  let input: z.infer<typeof evidenceSchema>;
  try { input = evidenceSchema.parse(raw); } catch (error) { await quarantine(db, quarantineMetadata(raw), error instanceof Error ? error.message : "Invalid evidence envelope"); throw error; }
  try {
    const run = await db.query("SELECT id FROM build_runs WHERE id=$1", [input.buildRunId]); if (!run.rowCount) throw new Error("BuildRun does not exist");
    let artifactId: number | null = null;
    if (input.artifactDigest) { const artifact = await db.query("SELECT id,build_run_id FROM artifacts WHERE digest_algorithm='sha256' AND digest=$1", [input.artifactDigest]); if (!artifact.rowCount) throw new Error("Artifact digest is unknown"); if (Number(artifact.rows[0].build_run_id) !== input.buildRunId) throw new Error("Evidence artifact does not belong to BuildRun"); artifactId = Number(artifact.rows[0].id); }
    const results = normalizeEvidence(input.format, input.content); const normalized = summary(results); const sourceDigest = createHash("sha256").update(input.content).digest("hex");
    const inserted = await db.query(`INSERT INTO evidence(artifact_id,build_run_id,evidence_type,format,source,source_digest,raw_storage_ref,status,summary,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (source_digest,build_run_id,artifact_id) DO UPDATE SET source=EXCLUDED.source RETURNING *`, [artifactId,input.buildRunId,input.evidenceType,input.format,input.source,sourceDigest,input.rawStorageRef,normalized.status,normalized.summary,input.provenance]);
    return inserted.rows[0];
  } catch (error) { await quarantine(db, input, error instanceof Error ? error.message : "Invalid evidence"); throw error; }
}
