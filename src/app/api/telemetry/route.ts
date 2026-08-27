import { NextResponse } from "next/server";
import { telemetrySummary } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", ...telemetrySummary() });
}
