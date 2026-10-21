import { requireAccess, requireResourceAccess } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { readLimitedBody } from "@/lib/github/security";
import { configureSystemSuite, listSystemTestRuns, recordSystemTestRun, registerSystemEnvironment, registerSystemProvider } from "@/lib/system-tests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 1_000_000)).toString("utf8"));
    if (operation === "providers" || operation === "environments") await requireAccess(request, "configuration_write", Number(body.repositoryId));
    else if (operation === "configure") await requireAccess(request, "configuration_write", Number(body.repositoryId));
    else if (operation === "runs") await requireResourceAccess(request, "configuration_write", "artifact", Number(body.artifactId));
    else return json({ error: "Not found" }, 404);
    if (operation === "providers") return json(await registerSystemProvider(getDb(), body), 201);
    if (operation === "environments") return json(await registerSystemEnvironment(getDb(), body), 201);
    if (operation === "configure") return json(await configureSystemSuite(getDb(), body), 201);
    if (operation === "runs") return json(await recordSystemTestRun(getDb(), body), 201);
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
    await requireResourceAccess(request, "read", "artifact", artifactId);
    if (operation === "runs") return json(await listSystemTestRuns(getDb(), artifactId));
    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
