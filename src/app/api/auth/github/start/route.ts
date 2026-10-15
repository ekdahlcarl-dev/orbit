import { NextResponse } from "next/server";
import { createOAuthState, githubAuthorizeUrl } from "@/lib/auth/oauth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.ORBIT_AUTH_SECRET;
  const base = process.env.ORBIT_PUBLIC_URL;
  if (!clientId || !secret || !base || secret.length < 32) return new Response("OAuth not configured", { status: 503 });
  const origin = new URL(base);
  if (origin.protocol !== "https:" && origin.hostname !== "localhost") return new Response("Invalid OAuth URL", { status: 503 });
  const state = createOAuthState(secret);
  const redirectUri = new URL("/api/auth/github/callback", origin).toString();
  const response = NextResponse.redirect(githubAuthorizeUrl(clientId, redirectUri, state));
  response.cookies.set("orbit_oauth_state", state, { httpOnly: true, secure: origin.protocol === "https:", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
