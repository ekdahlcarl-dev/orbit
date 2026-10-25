import { NextResponse } from "next/server";
import { AUTH_COOKIE, parseCookie, revokeSession } from "@/lib/auth/store";
import { requireSameOrigin } from "@/lib/auth/guard";
import { errorResponse } from "@/lib/github/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await revokeSession(parseCookie(request.headers.get("cookie"), AUTH_COOKIE));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE, "", { httpOnly: true, secure: new URL(process.env.ORBIT_PUBLIC_URL!).protocol === "https:", sameSite: "lax", path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) { return errorResponse(error); }
}
