import { getDb } from "../db";
import type { Pool } from "pg";
import { IntegrationError } from "../github/security";
import { requireGithubSession } from "./guard";

export type OrbitRole = "viewer" | "product_owner" | "admin";
export type OrbitAction = "read" | "recommendation_decide" | "build_trigger" | "configuration_write" | "user_admin";

export const grants: Record<OrbitRole, readonly OrbitAction[]> = {
  viewer: ["read"],
  product_owner: ["read", "recommendation_decide"],
  admin: ["read", "recommendation_decide", "build_trigger", "configuration_write", "user_admin"],
};

export function canPerform(role: OrbitRole, action: OrbitAction): boolean {
  return grants[role].includes(action);
}

export function authorizeRole(role: OrbitRole | null, action: OrbitAction): void {
  if (!role || !canPerform(role, action)) throw new IntegrationError(403, "Insufficient permissions");
}

export function authorizeRepository(granted: boolean): void {
  if (!granted) throw new IntegrationError(403, "Repository access denied");
}

export async function requireAccess(request: Request, action: OrbitAction, repositoryId?: number) {
  const identity = await requireGithubSession(request);
  const role = await authorizeIdentity(getDb(), identity.id, action, repositoryId);
  return { identity, role };
}

export async function listAuthorizedRepositories(request: Request): Promise<number[]> {
  const { identity } = await requireAccess(request, "read");
  const result = await getDb().query<{ repository_id: string }>(
    "SELECT repository_id FROM orbit_repository_grants WHERE github_user_id=$1 ORDER BY repository_id",
    [identity.id],
  );
  return result.rows.map(row => Number(row.repository_id));
}

/** Resolve repository ownership server-side; never accept a repository ID from an artifact/build request. */
export async function repositoryForResource(db: Pick<Pool, "query">, resource: "artifact" | "build" | "action", id: number): Promise<number> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new IntegrationError(400, "Invalid resource ID");
  const sql = {
    artifact: "SELECT repository_id FROM artifacts WHERE id=$1",
    build: "SELECT repository_id FROM build_runs WHERE id=$1",
    action: "SELECT i.repository_id FROM recommendation_actions a JOIN recommendation_items i ON i.id=a.recommendation_id WHERE a.id=$1",
  }[resource];
  const result = await db.query(sql, [id]);
  if (!result.rowCount) throw new IntegrationError(404, "Resource not found");
  return Number(result.rows[0].repository_id);
}

export async function requireResourceAccess(request: Request, action: OrbitAction, resource: "artifact" | "build" | "action", id: number) {
  const repositoryId = await repositoryForResource(getDb(), resource, id);
  return requireAccess(request, action, repositoryId);
}

/** Testable DB-backed authorization decision with the same SQL used in production. */
export async function authorizeIdentity(db: Pick<Pool, "query">, githubUserId: number, action: OrbitAction, repositoryId?: number): Promise<OrbitRole> {
  const result = await db.query("SELECT role FROM orbit_user_roles WHERE github_user_id=$1", [githubUserId]);
  const role = result.rows[0]?.role as OrbitRole | undefined;
  authorizeRole(role ?? null, action);
  if (repositoryId !== undefined) {
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new IntegrationError(400, "Invalid repository ID");
    const allowed = await db.query("SELECT 1 FROM orbit_repository_grants WHERE github_user_id=$1 AND repository_id=$2", [githubUserId, repositoryId]);
    authorizeRepository(Boolean(allowed.rowCount));
  }
  return role as OrbitRole;
}
