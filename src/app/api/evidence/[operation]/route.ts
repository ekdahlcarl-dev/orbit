import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { readLimitedBody, requireOperator } from "@/lib/github/security";
import { ingestEvidence, registerArtifact } from "@/lib/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireOperator(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 5_500_000)).toString("utf8"));
    if (operation === "artifacts") return json(await registerArtifact(getDb(), body), 201);
    if (operation === "ingest") return json(await ingestEvidence(getDb(), body), 201);
    return json({ error: "Not found" }, 404);
  } catch (error) { return errorResponse(error); }
}