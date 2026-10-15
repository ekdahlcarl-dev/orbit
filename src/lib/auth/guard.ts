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
  if (!origin || !publicUrl || origin !== new URL(publicUrl).origin) {
    throw new IntegrationError(403, "Cross-origin request rejected");
  }
}
