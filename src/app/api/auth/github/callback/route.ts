import { NextResponse } from "next/server";
import { parseGithubIdentity, verifyOAuthState } from "@/lib/auth/oauth";
import { AUTH_COOKIE, consumeOAuthState, createSession, parseCookie } from "@/lib/auth/store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const secret = process.env.ORBIT_AUTH_SECRET;
  const base = process.env.ORBIT_PUBLIC_URL;
  if (!clientId || !clientSecret || !secret || !base || secret.length < 32) return new Response("OAuth not configured", { status: 503 });
  try {
    const configured = new URL(base);
    const incoming = new URL(request.url);
    // Codespaces and other trusted reverse proxies may rewrite request.url to an internal origin.
    // Bind the callback to the configured public URL through the OAuth redirect URI,
    // signed state and same-site state cookie; do not trust forwarded host headers.
    if (incoming.pathname !== "/api/auth/github/callback") return new Response("Invalid callback path", { status: 403 });
    const state = incoming.searchParams.get("state") ?? "";
    const code = incoming.searchParams.get("code") ?? "";
    const cookieState = parseCookie(request.headers.get("cookie"), "orbit_oauth_state");
    const verified = verifyOAuthState(state, secret);
    if (!code || !verified || !cookieState || state !== cookieState) return new Response("Invalid OAuth callback", { status: 401 });
    if (!await consumeOAuthState(verified.nonce)) return new Response("OAuth state expired or already used", { status: 401 });
    const redirectUri = new URL("/api/auth/github/callback", configured).toString();
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) throw new Error("Token exchange failed");
    const tokenData: unknown = await tokenResponse.json();
    const token = tokenData && typeof tokenData === "object" && "access_token" in tokenData ? (tokenData as { access_token?: unknown }).access_token : undefined;
    if (typeof token !== "string" || !token) throw new Error("Token missing");
    const profileResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "ORBIT" },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) throw new Error("Identity lookup failed");
    const user = parseGithubIdentity(await profileResponse.json());
    const session = await createSession(user);
    const response = NextResponse.redirect(new URL("/dashboard", configured));
    response.cookies.set(AUTH_COOKIE, session, { httpOnly: true, secure: configured.protocol === "https:", sameSite: "lax", path: "/", maxAge: 28800 });
    response.cookies.set("orbit_oauth_state", "", { httpOnly: true, secure: configured.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return new Response("GitHub authentication failed", { status: 401 }); }
}
