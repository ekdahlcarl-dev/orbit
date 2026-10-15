import { NextResponse } from "next/server";
import { AUTH_COOKIE, parseCookie, revokeSession } from "@/lib/auth/store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (!origin || origin !== url.origin) return new Response("Forbidden", { status: 403 });
  try {
    await revokeSession(parseCookie(request.headers.get("cookie"), AUTH_COOKIE));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE, "", { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return new Response("Logout failed", { status: 503 }); }
}
