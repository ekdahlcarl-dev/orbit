import { z } from "zod";
import { getDb } from "@/lib/db";
import { errorResponse,json } from "@/lib/github/http";
import { requireOperator } from "@/lib/github/security";
import { recommendTesting } from "@/lib/ai-assistant";
import { embedQuestion,getOpenAiProvider } from "@/lib/openai-provider";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const bodySchema=z.object({question:z.string().min(3).max(2000),repositoryId:z.number().int().positive(),artifactId:z.number().int().positive().optional(),componentId:z.number().int().positive().optional(),since:z.string().datetime().optional()}).strict();
export async function POST(request:Request){try{requireOperator(request);const body=bodySchema.parse(await request.json());const {provider,apiKey}=getOpenAiProvider();const embedding=await embedQuestion(body.question,apiKey);return json(await recommendTesting(getDb(),provider,body.question,{repositoryId:body.repositoryId,artifactId:body.artifactId,componentId:body.componentId,since:body.since?new Date(body.since):undefined},embedding));}catch(error){return errorResponse(error)}}
