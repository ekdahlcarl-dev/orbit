import { requireAccess, requireResourceAccess } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { readLimitedBody } from "@/lib/github/security";
import { configureConfidenceRequirement, getConfidenceHistory, recalculateConfidence, recordConfidenceEvidence } from "@/lib/confidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 1_000_000)).toString("utf8"));
    if (operation === "configure") await requireAccess(request, "configuration_write", Number(body.repositoryId));
    else if (operation === "evidence" || operation === "recalculate") await requireResourceAccess(request, "configuration_write", "artifact", Number(body.artifactId));
    else return json({ error: "Not found" }, 404);
    if (operation === "configure") return json(await configureConfidenceRequirement(getDb(), body), 201);
    if (operation === "evidence") return json(await recordConfidenceEvidence(getDb(), body), 201);
    if (operation === "recalculate") {
      const artifactId = Number(body.artifactId);
      if (!Number.isInteger(artifactId) || artifactId <= 0) return json({ error: "Invalid artifactId" }, 400);
    await requireResourceAccess(request, "read", "artifact", artifactId);
      return json(await recalculateConfidence(getDb(), artifactId));
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request, context: Context) {
  try {
    const { operation } = await context.params;
    const artifactId = Number(new URL(request.url).searchParams.get("artifactId"));
    if (!Number.isInteger(artifactId) || artifactId <= 0) return json({ error: "Invalid artifactId" }, 400);
    if (operation === "status") return json(await recalculateConfidence(getDb(), artifactId));
    if (operation === "history") return json(await getConfidenceHistory(getDb(), artifactId));
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
