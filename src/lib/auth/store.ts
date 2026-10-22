import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db";
import type { GithubIdentity } from "./oauth";

export const AUTH_COOKIE = "orbit_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function parseCookie(header: string | null, name: string): string | undefined {
  const item = header?.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return item?.slice(name.length + 1);
}
export async function registerOAuthState(nonce: string, expiresAt: number): Promise<void> {
  await getDb().query("INSERT INTO orbit_oauth_states(nonce_hash,expires_at) VALUES($1,$2)", [digest(nonce), new Date(expiresAt)]);
}
export async function consumeOAuthState(nonce: string): Promise<boolean> {
  const result = await getDb().query("DELETE FROM orbit_oauth_states WHERE nonce_hash=$1 AND expires_at>now() RETURNING nonce_hash", [digest(nonce)]);
  return Boolean(result.rowCount);
}
export async function createSession(user: GithubIdentity): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getDb().query("INSERT INTO orbit_auth_sessions(token_hash,github_user_id,github_login,expires_at) VALUES($1,$2,$3,$4)", [digest(token), user.id, user.login, new Date(Date.now() + SESSION_MS)]);
  return token;
}
export async function getSession(token: string | undefined): Promise<GithubIdentity | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await getDb().query("SELECT github_user_id,github_login FROM orbit_auth_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [digest(token)]);
  if (!result.rowCount) return null;
  return { id: Number(result.rows[0].github_user_id), login: String(result.rows[0].github_login) };
}
export async function revokeSession(token: string | undefined): Promise<void> {
  if (token) await getDb().query("UPDATE orbit_auth_sessions SET revoked_at=now() WHERE token_hash=$1", [digest(token)]);
}
