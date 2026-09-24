import { IntegrationError, requireOperator } from "./github/security";

export type OrbitRole = "viewer" | "product_owner" | "admin";
export type OrbitAction = "read" | "recommendation_decide" | "build_trigger" | "configuration_write" | "user_admin";

const grants: Record<OrbitRole, readonly OrbitAction[]> = {
  viewer: ["read"],
  product_owner: ["read", "recommendation_decide"],
  admin: ["read", "recommendation_decide", "build_trigger", "configuration_write", "user_admin"],
};

/**
 * Transitional authorization boundary. An authenticated legacy operator maps
 * to admin until individual identities and repository grants are implemented.
 * Never accept a role or repository grant supplied by the browser.
 */
export function requireRole(request: Request, action: OrbitAction): { identity: string; role: OrbitRole } {
  const identity = requireOperator(request);
  const role: OrbitRole = "admin";
  if (!grants[role].includes(action)) throw new IntegrationError(403, "Insufficient permissions");
  return { identity, role };
}

export function canPerform(role: OrbitRole, action: OrbitAction): boolean {
  return grants[role].includes(action);
}
