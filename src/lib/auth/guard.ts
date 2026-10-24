import { IntegrationError } from "../github/security";
import { AUTH_COOKIE, getSession, parseCookie } from "./store";
import type { GithubIdentity } from "./oauth";

export async function requireGithubSession(request: Request): Promise<GithubIdentity> {
  const identity = await getSession(parseCookie(request.headers.get("cookie"), AUTH_COOKIE));
  if (!identity) throw new IntegrationError(401, "GitHub authentication required");
  return identity;
}
/** Restrict browser-originated mutations; never trust forwarded host headers. */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const publicUrl = process.env.ORBIT_PUBLIC_URL;
  if (!origin || !publicUrl) {
    throw new IntegrationError(403, "Cross-origin request rejected");
  }
  const expectedOrigin = new URL(publicUrl).origin;
  // Codespaces can rewrite the browser Origin to the local forwarded port.
  // Allow only the explicit development proxy case; never in production.
  const codespacesLocalOrigin =
    process.env.CODESPACES === "true" &&
    process.env.NODE_ENV === "development" &&
    /^https:\/\/[a-z0-9-]+-3001\.app\.github\.dev$/.test(expectedOrigin) &&
    origin === "http://localhost:3001";

  if (origin !== expectedOrigin && !codespacesLocalOrigin) {
    throw new IntegrationError(403, "Cross-origin request rejected");
  }
}
