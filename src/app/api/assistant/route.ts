import { getDb } from "@/lib/db";
import { recommendTesting } from "@/lib/ai-assistant";
import { OpenAiRecommendationProvider } from "@/lib/ai-provider";
import { errorResponse, json } from "@/lib/github/http";
import { requireOperator } from "@/lib/github/security";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  repositoryId: z.number().int().positive(),
  artifactId: z.number().int().positive().optional(),
  componentId: z.number().int().positive().optional(),
  since: z.string().datetime().optional(),
  question: z.string().trim().min(3).max(2000),
}).strict();

export async function POST(request: Request) {
  try {
    requireOperator(request);
    if (Number(request.headers.get("content-length")) > 8192) return json({ error: "Request too large" }, 413);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Invalid assistant request", details: parsed.error.issues }, 400);
    const { repositoryId, artifactId, componentId, since, question } = parsed.data;
    const key = process.env.OPENAI_API_KEY;
    if (!key) return json({ error: "AI provider is not configured (OPENAI_API_KEY)" }, 503);
    const db = getDb();
    const authorized = await db.query("SELECT 1 FROM github_repositories WHERE repository_id=$1 AND enabled=true", [repositoryId]);
    if (!authorized.rowCount) return json({ error: "Repository not configured or disabled" }, 404);
    const provider = new OpenAiRecommendationProvider(key, process.env.ORBIT_AI_MODEL || "gpt-4.1-mini");
    const result = await recommendTesting(db, provider, question, {
      repositoryId, artifactId, componentId, since: since ? new Date(since) : undefined,
    });
    return json(result);
  } catch (error) { 

  console.error("ORB-12 assistant request failed:", error);
  return errorResponse(error);


  }
}
