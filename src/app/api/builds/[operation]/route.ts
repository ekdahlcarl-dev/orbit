import { getDb } from "@/lib/db";
import { GitHubClient } from "@/lib/github/client";
import { errorResponse, json } from "@/lib/github/http";
import { idSchema, readLimitedBody, requireInstallation, requireOperator } from "@/lib/github/security";
import { buildSettingsSchema, listBuildRuns, manualBuildSchema, queueManualBuild, saveBuildSettings } from "@/lib/builds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function GET(request: Request, context: Context) {
  try {
    requireOperator(request);
    const { operation } = await context.params;
    if (operation !== "runs") return json({ error: "Not found" }, 404);
    const query = new URL(request.url).searchParams;
    const installationId = idSchema.parse(query.get("installationId"));
    requireInstallation(installationId);
    const github = new GitHubClient();
    const repositoryIds = (await github.repositories(installationId)).map(item => item.id);
    return json(await listBuildRuns(getDb(), installationId, repositoryIds));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = requireOperator(request);
    const { operation } = await context.params;
    const body = JSON.parse((await readLimitedBody(request, 16384)).toString("utf8"));
    const github = new GitHubClient();
    if (operation === "settings") {
      const input = buildSettingsSchema.parse(body);
      requireInstallation(input.installationId);
      return json(await saveBuildSettings(getDb(), github, input, actor));
    }
    if (operation === "manual") {
      const input = manualBuildSchema.parse(body);
      requireInstallation(input.installationId);
      return json(await queueManualBuild(getDb(), github, input, actor), 202);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) { return errorResponse(error); }
}
