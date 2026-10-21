// Compatibility API for legacy callers. Never elevate Basic Auth to admin.
// Use async requireAccess from auth/rbac for all protected routes.
export { canPerform } from "./auth/rbac";
export type { OrbitRole, OrbitAction } from "./auth/rbac";
import { IntegrationError } from "./github/security";
import type { OrbitAction } from "./auth/rbac";
export function requireRole(_request: Request, _action: OrbitAction): never {
  throw new IntegrationError(403, "Legacy operator authorization disabled; use session RBAC");
}
