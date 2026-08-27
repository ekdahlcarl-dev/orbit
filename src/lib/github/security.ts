import type { EnvironmentInput } from "../config";
import { createHash, createHmac, sign, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export class IntegrationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const configurationSchema = z.object({
  installationId: idSchema,
  repositoryId: idSchema,
  ref: z.string().min(1).max(255).refine(value => !/[\s\x00-\x1f]/.test(value), "Invalid ref"),
  workflowId: idSchema,
  enabled: z.boolean(),
}).strict();
export type Configuration = z.infer<typeof configurationSchema>;

export function allowedInstallations(env: EnvironmentInput = process.env): number[] {
  const values = (env.GITHUB_ALLOWED_INSTALLATION_IDS ?? "").split(",").filter(Boolean);
  const parsed = z.array(idSchema).min(1).safeParse(values);
  if (!parsed.success) throw new IntegrationError(503, "GitHub installation allowlist is not configured");
  return parsed.data;
}

export function requireInstallation(id: number, env: EnvironmentInput = process.env) {
  if (!allowedInstallations(env).includes(id)) throw new IntegrationError(403, "Installation is not authorized");
}

export function secretEquals(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// Temporary single-operator boundary until ORB-14 supplies individual identities/RBAC.
// No cookies: the browser sends an explicit Authorization header on each request.
export function requireOperator(request: Request, env: EnvironmentInput = process.env): string {
  const user = env.ORBIT_OPERATOR_USER;
  const password = env.ORBIT_OPERATOR_PASSWORD;
  if (!user || !password || password.length < 32) throw new IntegrationError(503, "Operator access is not configured");
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  if (!secretEquals(request.headers.get("authorization") ?? "", expected)) {
    throw new IntegrationError(401, "Operator credentials required");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new IntegrationError(403, "Cross-origin requests are not allowed");
  return user;
}

export function appJwt(env: EnvironmentInput = process.env, now = Math.floor(Date.now() / 1000)) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new IntegrationError(503, "GitHub App credentials are not configured");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")).toString("base64url")}`;
}

export function verifySignature(body: Buffer, signature: string | null, env: EnvironmentInput = process.env) {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) throw new IntegrationError(503, "Webhook secret is not configured");
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) throw new IntegrationError(401, "Invalid webhook signature");
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  if (!secretEquals(signature, expected)) throw new IntegrationError(401, "Invalid webhook signature");
}

export async function readLimitedBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > limit) throw new IntegrationError(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new IntegrationError(413, "Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
