import { requireAccess, requireResourceAccess } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { readLimitedBody } from "@/lib/github/security";
import { configureComponentSuite, ingestComponentSuite, listComponentSuites } from "@/lib/component-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 1_000_000)).toString("utf8"));
    if (operation === "configure") await requireAccess(request, "configuration_write", Number(body.repositoryId));
    else if (operation === "ingest") await requireResourceAccess(request, "configuration_write", "artifact", Number(body.artifactId));
    else return json({ error: "Not found" }, 404);
    if (operation === "configure") return json(await configureComponentSuite(getDb(), body), 201);
    if (operation === "ingest") return json(await ingestComponentSuite(getDb(), body), 201);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request, context: Context) {
  try {
    const { operation } = await context.params;
    if (operation !== "results") return json({ error: "Not found" }, 404);
    const artifactId = Number(new URL(request.url).searchParams.get("artifactId"));
    if (!Number.isInteger(artifactId) || artifactId <= 0) return json({ error: "Invalid artifactId" }, 400);
    await requireResourceAccess(request, "read", "artifact", artifactId);
    return json(await listComponentSuites(getDb(), artifactId));
  } catch (error) {
    return errorResponse(error);
  }
}
