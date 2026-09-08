import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { requireOperator } from "@/lib/github/security";
import { affectedComponents, affectedTests, rankComponentRisk } from "@/lib/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireOperator(request);
    const url=new URL(request.url);
    const raw=url.searchParams.get("repositoryId");
    const repositoryId=raw ? Number(raw) : undefined;
    if(raw && (!Number.isInteger(repositoryId) || Number(repositoryId)<=0)) return json({error:"Invalid repositoryId"},400);
    const commitSha=url.searchParams.get("commitSha");
    const db=getDb();
    if(commitSha && repositoryId) return json({affectedComponents:await affectedComponents(db,repositoryId,commitSha),affectedTests:await affectedTests(db,repositoryId,commitSha)});
    return json({risks:await rankComponentRisk(db,repositoryId)});
  } catch(error) { return errorResponse(error); }
}
