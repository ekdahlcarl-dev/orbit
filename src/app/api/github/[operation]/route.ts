import { requireAccess, listAuthorizedRepositories } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { GitHubClient } from "@/lib/github/client";
import { errorResponse, json } from "@/lib/github/http";
import { configurationSchema, idSchema, readLimitedBody, requireInstallation } from "@/lib/github/security";
import { listAudit, listConfigurations, saveConfiguration } from "@/lib/github/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await requireAccess(request, "read");
    const { operation } = await context.params;
    const github = new GitHubClient();
    if (operation === "installations") {
      const granted = new Set(await listAuthorizedRepositories(request));
      const installations = await github.installations();
      const visible = [];
      for (const item of installations) {
        const ids = (await github.repositories(item.id)).map(repo => repo.id);
        if (ids.some(id => granted.has(id))) visible.push(item);
      }
      return json(visible);
    }
    const query = new URL(request.url).searchParams;
    const installationId = idSchema.parse(query.get("installationId"));
    requireInstallation(installationId);
    if (operation === "options") {
      const repositoryId = idSchema.parse(query.get("repositoryId"));
      await requireAccess(request, "read", repositoryId);
      return json(await github.options(installationId, repositoryId));
    }
    const granted = new Set(await listAuthorizedRepositories(request));
    const repositories = (await github.repositories(installationId)).filter(repo => granted.has(repo.id));
    if (operation === "repositories") return json(repositories);
    const ids = repositories.map(repo => repo.id);
    if (operation === "configurations") return json(await listConfigurations(getDb(), installationId, ids));
    if (operation === "audit") return json(await listAudit(getDb(), installationId, ids));
    return json({ error: "Not found" }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    if ((await context.params).operation !== "configurations") return json({ error: "Not found" }, 404);
    const input = configurationSchema.parse(JSON.parse((await readLimitedBody(request, 16384)).toString("utf8")));
    requireInstallation(input.installationId);
    const { identity } = await requireAccess(request, "configuration_write", input.repositoryId);
    return json(await saveConfiguration(getDb(), new GitHubClient(), input, identity.login));
  } catch (error) { return errorResponse(error); }
}
