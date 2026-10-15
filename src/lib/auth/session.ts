import { createHmac, timingSafeEqual } from "node:crypto";
import type { GithubIdentity } from "./oauth";

export type OrbitSession = { user: GithubIdentity; expiresAt: number };
const TTL = 8 * 60 * 60 * 1000;
function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
export function issueSession(user: GithubIdentity, secret: string, now = Date.now()): string {
  if (secret.length < 32) throw new Error("Session secret must be at least 32 characters");
  const payload = Buffer.from(JSON.stringify({ user, expiresAt: now + TTL })).toString("base64url");
  return payload + "." + sign(payload, secret);
}
export function readSession(cookie: string | undefined, secret: string, now = Date.now()): OrbitSession | null {
  if (!cookie || secret.length < 32) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const expected = Buffer.from(sign(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const session = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as OrbitSession;
    if (!session || !Number.isSafeInteger(session.user?.id) || session.user.id <= 0 ||
        typeof session.user.login !== "string" || !Number.isSafeInteger(session.expiresAt) ||
        session.expiresAt <= now || session.expiresAt > now + TTL) return null;
    return session;
  } catch { return null; }
}
export const sessionCookieName = "orbit_session";
export function sessionCookie(value: string, secure = true): string {
  return sessionCookieName + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800" + (secure ? "; Secure" : "");
}
export function clearSessionCookie(secure = true): string {
  return sessionCookieName + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : "");
}
