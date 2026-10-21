import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/rbac";
import { errorResponse } from "@/lib/github/http";
import { telemetrySummary } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAccess(request, "user_admin");
    return NextResponse.json({ status: "ok", ...telemetrySummary() });
  } catch (error) { return errorResponse(error); }
}
