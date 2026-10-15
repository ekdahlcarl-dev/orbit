import { NextResponse } from "next/server";
import { AUTH_COOKIE, getSession, parseCookie } from "@/lib/auth/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const identity = await getSession(parseCookie(request.headers.get("cookie"), AUTH_COOKIE));
    if (!identity) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ user: identity }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Authentication unavailable" }, { status: 503 }); }
}
