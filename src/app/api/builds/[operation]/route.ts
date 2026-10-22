import { requireAccess, listAuthorizedRepositories } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { GitHubClient } from "@/lib/github/client";
import { errorResponse, json } from "@/lib/github/http";
import { idSchema, readLimitedBody, requireInstallation } from "@/lib/github/security";
import { buildSettingsSchema, listBuildRuns, manualBuildSchema, queueManualBuild, saveBuildSettings } from "@/lib/builds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await requireAccess(request, "read");
    const { operation } = await context.params;
    if (operation !== "runs") return json({ error: "Not found" }, 404);
    const query = new URL(request.url).searchParams;
    const installationId = idSchema.parse(query.get("installationId"));
    requireInstallation(installationId);
    const github = new GitHubClient();
    const granted = new Set(await listAuthorizedRepositories(request));
    const repositoryIds = (await github.repositories(installationId)).map(item => item.id).filter(id => granted.has(id));
    return json(await listBuildRuns(getDb(), installationId, repositoryIds));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    await requireAccess(request, "read");
    requireSameOrigin(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 16384)).toString("utf8"));
    const github = new GitHubClient();
    if (operation === "settings") {
      const input = buildSettingsSchema.parse(body);
      requireInstallation(input.installationId);
      const { identity } = await requireAccess(request, "configuration_write", input.repositoryId);
      return json(await saveBuildSettings(getDb(), github, input, identity.login));
    }
    if (operation === "manual") {
      const input = manualBuildSchema.parse(body);
      requireInstallation(input.installationId);
      const { identity } = await requireAccess(request, "build_trigger", input.repositoryId);
      return json(await queueManualBuild(getDb(), github, input, identity.login), 202);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) { return errorResponse(error); }
}
