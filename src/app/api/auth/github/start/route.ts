import { NextResponse } from "next/server";
import { createOAuthState, githubAuthorizeUrl, verifyOAuthState } from "@/lib/auth/oauth";
import { registerOAuthState } from "@/lib/auth/store";
export const runtime = "nodejs";
export async function GET() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.ORBIT_AUTH_SECRET;
  const base = process.env.ORBIT_PUBLIC_URL;
  if (!clientId || !secret || !base || secret.length < 32) return new Response("OAuth not configured", { status: 503 });
  try {
    const origin = new URL(base);
    if ((origin.protocol !== "https:" && origin.hostname !== "localhost") || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") return new Response("Invalid OAuth URL", { status: 503 });
    const state = createOAuthState(secret);
    const parsed = verifyOAuthState(state, secret);
    if (!parsed) throw new Error("Invalid state");
    await registerOAuthState(parsed.nonce, parsed.expiresAt);
    const redirectUri = new URL("/api/auth/github/callback", origin).toString();
    const response = NextResponse.redirect(githubAuthorizeUrl(clientId, redirectUri, state));
    response.cookies.set("orbit_oauth_state", state, { httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax", path: "/", maxAge: 600 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return new Response("Authentication temporarily unavailable", { status: 503 }); }
}
