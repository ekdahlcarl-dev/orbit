import { NextResponse } from "next/server";
import { databaseHealth } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const database = await databaseHealth();
    return NextResponse.json({
      status: database ? "ok" : "degraded",
      service: "orbit",
      database,
      uptimeSeconds: Math.round(process.uptime()),
      durationMs: Date.now() - started,
    }, { status: database ? 200 : 503 });
  } catch (error) {
    logger.error({ err: error }, "health check failed");
    return NextResponse.json({ status: "unhealthy", service: "orbit", database: false }, { status: 503 });
  }
}
