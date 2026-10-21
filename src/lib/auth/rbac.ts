import { getDb } from "../db";
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
  const db = getDb();
  const result = await db.query<{ role: OrbitRole }>(
    "SELECT role FROM orbit_user_roles WHERE github_user_id=$1",
    [identity.id],
  );
  const role = result.rows[0]?.role ?? null;
  authorizeRole(role, action);
  if (repositoryId !== undefined) {
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
      throw new IntegrationError(400, "Invalid repository ID");
    }
    const allowed = await db.query(
      "SELECT 1 FROM orbit_repository_grants WHERE github_user_id=$1 AND repository_id=$2",
      [identity.id, repositoryId],
    );
    authorizeRepository(Boolean(allowed.rowCount));
  }
  return { identity, role: role as OrbitRole };
}

export async function listAuthorizedRepositories(request: Request): Promise<number[]> {
  const { identity } = await requireAccess(request, "read");
  const result = await getDb().query<{ repository_id: string }>(
    "SELECT repository_id FROM orbit_repository_grants WHERE github_user_id=$1 ORDER BY repository_id",
    [identity.id],
  );
  return result.rows.map(row => Number(row.repository_id));
}
