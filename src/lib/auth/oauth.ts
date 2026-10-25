import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type GithubIdentity = { id: number; login: string };
export type OAuthState = { nonce: string; expiresAt: number };

function mac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function secureEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function requireSecret(secret: string): void {
  if (secret.length < 32) throw new Error("OAuth signing secret must be at least 32 characters");
}
export function createOAuthState(secret: string, now = Date.now()): string {
  requireSecret(secret);
  const value: OAuthState = { nonce: randomBytes(24).toString("base64url"), expiresAt: now + 10 * 60_000 };
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return payload + "." + mac(payload, secret);
}
export function verifyOAuthState(state: string, secret: string, now = Date.now()): OAuthState | null {
  requireSecret(secret);
  if (state.length > 2048) return null;
  const parts = state.split(".");
  if (parts.length !== 2 || !secureEqual(mac(parts[0], secret), parts[1])) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<OAuthState>;
    if (typeof candidate.nonce !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(candidate.nonce)) return null;
    if (typeof candidate.expiresAt !== "number" || !Number.isSafeInteger(candidate.expiresAt) || candidate.expiresAt <= now || candidate.expiresAt > now + 10 * 60_000) return null;
    return candidate as OAuthState;
  } catch { return null; }
}
export function githubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}
export function parseGithubIdentity(value: unknown): GithubIdentity {
  if (!value || typeof value !== "object") throw new Error("Invalid GitHub identity");
  const user = value as Record<string, unknown>;
  if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0 || typeof user.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(user.login)) {
    throw new Error("Invalid GitHub identity");
  }
  return { id: Number(user.id), login: user.login };
}
