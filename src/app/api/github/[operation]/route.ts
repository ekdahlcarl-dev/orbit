import { getDb } from "@/lib/db";
import { GitHubClient } from "@/lib/github/client";
import { errorResponse, json } from "@/lib/github/http";
import { configurationSchema, idSchema, readLimitedBody, requireInstallation, requireOperator } from "@/lib/github/security";
import { listAudit, listConfigurations, saveConfiguration } from "@/lib/github/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function GET(request: Request, context: Context) {
  try {
    requireOperator(request);
    const { operation } = await context.params;
    const github = new GitHubClient();
    if (operation === "installations") return json(await github.installations());
    const query = new URL(request.url).searchParams;
    const installationId = idSchema.parse(query.get("installationId"));
    requireInstallation(installationId);
    if (operation === "options") return json(await github.options(installationId, idSchema.parse(query.get("repositoryId"))));
    const repositories = await github.repositories(installationId);
    if (operation === "repositories") return json(repositories);
    const ids = repositories.map(repo => repo.id);
    if (operation === "configurations") return json(await listConfigurations(getDb(), installationId, ids));
    if (operation === "audit") return json(await listAudit(getDb(), installationId, ids));
    return json({ error: "Not found" }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = requireOperator(request);
    if ((await context.params).operation !== "configurations") return json({ error: "Not found" }, 404);
    const input = configurationSchema.parse(JSON.parse((await readLimitedBody(request, 16384)).toString("utf8")));
    requireInstallation(input.installationId);
    return json(await saveConfiguration(getDb(), new GitHubClient(), input, actor));
  } catch (error) { return errorResponse(error); }
}
