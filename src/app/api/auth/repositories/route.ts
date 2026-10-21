import { getDb } from "@/lib/db";
import { listAuthorizedRepositories } from "@/lib/auth/rbac";
import { errorResponse, json } from "@/lib/github/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ids = await listAuthorizedRepositories(request);
    if (!ids.length) return json([]);
    const result = await getDb().query(
      "SELECT repository_id, full_name FROM github_repositories WHERE repository_id = ANY($1::bigint[]) ORDER BY full_name",
      [ids],
    );
    return json(result.rows);
  } catch (error) {
    return errorResponse(error);
  }
}
