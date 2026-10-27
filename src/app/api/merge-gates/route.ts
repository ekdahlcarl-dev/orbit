import { requireAccess } from "@/lib/auth/rbac";
import { requireSameOrigin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { transaction } from "@/lib/github/store";
import { errorResponse, json } from "@/lib/github/http";
import { readLimitedBody } from "@/lib/github/security";
import { configureMergeGate, mergeGateCheckName, mergeGatePolicySchema } from "@/lib/merge-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = mergeGatePolicySchema.parse(JSON.parse((await readLimitedBody(request, 4096)).toString("utf8")));
    const { identity } = await requireAccess(request, "configuration_write", input.repositoryId);
    return json(await transaction(getDb(), db => configureMergeGate(db, input, `github:${identity.id}:${identity.login}`)));
  } catch (error) { return errorResponse(error); }
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const repositoryId = Number(params.get("repositoryId"));
    await requireAccess(request, "read", repositoryId);
    const policies = (await getDb().query("SELECT * FROM merge_gate_policies WHERE repository_id=$1 ORDER BY branch_pattern", [repositoryId])).rows;
    const decisions = (await getDb().query("SELECT * FROM merge_gate_decisions WHERE repository_id=$1 ORDER BY id DESC LIMIT 100", [repositoryId])).rows;
    return json({ policies, decisions, checkName: params.get("branch") ? mergeGateCheckName(params.get("branch")!) : null });
  } catch (error) { return errorResponse(error); }
}
