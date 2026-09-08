import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { requireOperator } from "@/lib/github/security";
import { getDashboard } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireOperator(request);
    const url = new URL(request.url);
    const repositoryId = Number(url.searchParams.get("repositoryId"));
    const artifactId = Number(url.searchParams.get("artifactId"));
    const fromRaw = url.searchParams.get("from");
    const from = fromRaw ? new Date(fromRaw) : undefined;
    if (fromRaw && Number.isNaN(from?.getTime())) return json({ error: "Invalid from timestamp" }, 400);
    return json(await getDashboard(getDb(), {
      repositoryId: Number.isInteger(repositoryId) && repositoryId > 0 ? repositoryId : undefined,
      branch: url.searchParams.get("branch") || undefined,
      binary: url.searchParams.get("binary") || undefined,
      from,
      artifactId: Number.isInteger(artifactId) && artifactId > 0 ? artifactId : undefined,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
