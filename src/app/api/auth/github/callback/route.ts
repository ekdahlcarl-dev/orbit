import { NextResponse } from "next/server";
import { parseGithubIdentity, verifyOAuthState } from "@/lib/auth/oauth";
import { issueSession, sessionCookieName } from "@/lib/auth/session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const secret = process.env.ORBIT_AUTH_SECRET;
  const base = process.env.ORBIT_PUBLIC_URL;
  if (!clientId || !clientSecret || !secret || !base || secret.length < 32) return new Response("OAuth not configured", { status: 503 });
  const configured = new URL(base);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const cookieState = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith("orbit_oauth_state="))?.slice("orbit_oauth_state=".length);
  if (!code || !state || !cookieState || state !== cookieState || !verifyOAuthState(state, secret)) return new Response("Invalid OAuth callback", { status: 401 });
  const redirectUri = new URL("/api/auth/github/callback", configured).toString();
  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) throw new Error("OAuth token exchange failed");
    const tokenData: unknown = await tokenResponse.json();
    const token = tokenData && typeof tokenData === "object" && "access_token" in tokenData ? (tokenData as { access_token?: unknown }).access_token : undefined;
    if (typeof token !== "string" || !token) throw new Error("OAuth token missing");
    const profileResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "ORBIT" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) throw new Error("GitHub identity lookup failed");
    const user = parseGithubIdentity(await profileResponse.json());
    const response = NextResponse.redirect(new URL("/dashboard", configured));
    response.cookies.set(sessionCookieName, issueSession(user, secret), {
      httpOnly: true, secure: configured.protocol === "https:", sameSite: "lax", path: "/", maxAge: 28800,
    });
    response.cookies.set("orbit_oauth_state", "", { httpOnly: true, secure: configured.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  } catch {
    return new Response("GitHub authentication failed", { status: 401 });
  }
}
