import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireOperator } from "@/lib/github/security";
import { affectedComponents, affectedTests, rankComponentRisk } from "@/lib/risk";

export async function GET(request: Request) {
  const auth=requireOperator(request); if(auth instanceof Response) return auth;
  const url=new URL(request.url); const db=getPool();
  const repositoryId=url.searchParams.get("repositoryId") ? Number(url.searchParams.get("repositoryId")) : undefined;
  const commitSha=url.searchParams.get("commitSha");
  try {
    if(commitSha && repositoryId) return NextResponse.json({ affectedComponents:await affectedComponents(db,repositoryId,commitSha), affectedTests:await affectedTests(db,repositoryId,commitSha) });
    return NextResponse.json({ risks:await rankComponentRisk(db,repositoryId) });
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Risk query failed"},{status:400}); }
}
