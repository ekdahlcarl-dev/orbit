import { transaction } from "@/lib/github/store";
import { requireAccess } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { GitHubClient } from "@/lib/github/client";
import { errorResponse, json } from "@/lib/github/http";
import { idSchema, readLimitedBody, requireInstallation } from "@/lib/github/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only repository discovery and self-service grants.
 * A GitHub installation must actually expose the repository before a grant can be added.
 * Existing repository grants remain the authorization boundary for all other endpoints.
 */
export async function GET(request: Request) {
  try {
    const { identity } = await requireAccess(request, "user_admin");
    const github = new GitHubClient();
    const db = getDb();
    const grants = await db.query<{ repository_id: string }>(
      "SELECT repository_id FROM orbit_repository_grants WHERE github_user_id=$1",
      [identity.id],
    );
    const granted = new Set(grants.rows.map(row => Number(row.repository_id)));
    const installations = await github.installations();
    const available = await Promise.all(installations.map(async installation => ({
      installationId: installation.id,
      account: installation.account.login,
      repositories: (await github.repositories(installation.id)).map(repository => ({
        ...repository,
        granted: granted.has(repository.id),
      })),
    })));
    return json(available);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { identity } = await requireAccess(request, "user_admin");
    requireSameOrigin(request);
    const body = JSON.parse((await readLimitedBody(request, 4096)).toString("utf8")) as Record<string, unknown>;
    const installationId = idSchema.parse(body.installationId);
    const repositoryId = idSchema.parse(body.repositoryId);
    requireInstallation(installationId);
    const github = new GitHubClient();
    const repository = (await github.repositories(installationId)).find(item => item.id === repositoryId);
    if (!repository || repository.archived) return json({ error: "Repository is not available for this installation" }, 403);

    const db = getDb();
    const created = await transaction(db, async client => {
      await client.query("SELECT set_config('orbit.actor', $1, true)", [`github:${identity.id}:${identity.login}`]);
      const result = await client.query(
        "INSERT INTO orbit_repository_grants (github_user_id,repository_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING repository_id",
        [identity.id, repositoryId],
      );
      return Boolean(result.rowCount);
    });
    return json({ repositoryId, granted: true, created });
  } catch (error) { return errorResponse(error); }
}
