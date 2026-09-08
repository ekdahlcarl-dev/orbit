import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { readLimitedBody, requireOperator } from "@/lib/github/security";
import { configureStaticAnalysis, getLevel1Assessment, ingestStaticAnalysis } from "@/lib/static-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireOperator(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 1_000_000)).toString("utf8"));
    if (operation === "configure") return json(await configureStaticAnalysis(getDb(), body), 201);
    if (operation === "sonar") return json(await ingestStaticAnalysis(getDb(), "sonar", body), 201);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request, context: Context) {
  try {
    requireOperator(request);
    const { operation } = await context.params;
    if (operation !== "level-1") return json({ error: "Not found" }, 404);
    const buildRunId = Number(new URL(request.url).searchParams.get("buildRunId"));
    if (!Number.isInteger(buildRunId) || buildRunId <= 0) return json({ error: "Invalid buildRunId" }, 400);
    return json(await getLevel1Assessment(getDb(), buildRunId));
  } catch (error) {
    return errorResponse(error);
  }
}
