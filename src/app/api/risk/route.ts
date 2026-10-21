import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { requireAccess, listAuthorizedRepositories } from "@/lib/auth/rbac";
import { affectedComponents, affectedTests, rankComponentRisk } from "@/lib/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAccess(request, "read");
    const url=new URL(request.url);
    const raw=url.searchParams.get("repositoryId");
    const repositoryId=raw ? Number(raw) : undefined;
    if(raw && (!Number.isInteger(repositoryId) || Number(repositoryId)<=0)) return json({error:"Invalid repositoryId"},400);
    const commitSha=url.searchParams.get("commitSha");
    if (repositoryId) await requireAccess(request, "read", repositoryId);
    const db=getDb();
    if(commitSha && repositoryId) return json({affectedComponents:await affectedComponents(db,repositoryId,commitSha),affectedTests:await affectedTests(db,repositoryId,commitSha)});
    if (repositoryId) return json({risks:await rankComponentRisk(db,repositoryId)});
    const ids = await listAuthorizedRepositories(request);
    const risks = (await Promise.all(ids.map(id => rankComponentRisk(db,id)))).flat();
    return json({risks});
  } catch(error) { return errorResponse(error); }
}
