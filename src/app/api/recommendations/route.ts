import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { requireOperator } from "@/lib/github/security";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const id = z.number().int().positive();
const command = z.discriminatedUnion("type", [
 z.object({type:z.literal("seed"),repositoryId:id}).strict(),
 z.object({type:z.literal("decide"),repositoryId:id,id,decision:z.enum(["accepted","rejected","deferred"]),rationale:z.string().max(2000).default("")}).strict(),
 z.object({type:z.literal("action"),repositoryId:id,id,description:z.string().trim().min(1).max(2000)}).strict(),
 z.object({type:z.literal("outcome"),repositoryId:id,actionId:id,outcome:z.string().trim().min(1).max(2000),defectsFound:z.number().int().min(0)}).strict()
]);
async function enabled(repositoryId:number) {
 const db=getDb();
 const result=await db.query("SELECT 1 FROM github_repositories WHERE repository_id=$1 AND enabled=true",[repositoryId]);
 return Boolean(result.rowCount);
}
export async function GET(request:Request) {
 try {
  requireOperator(request);
  const repositoryId=Number(new URL(request.url).searchParams.get("repositoryId"));
  if(!Number.isSafeInteger(repositoryId)||repositoryId<1) return json({error:"Invalid repository ID"},400);
  if(!await enabled(repositoryId)) return json({error:"Repository not configured or disabled"},404);
  const db=getDb();
  // Idempotently import real recommendations already stored by ORB-12.
  await db.query(`INSERT INTO recommendation_items(repository_id,run_id,source,component_key,target_level,action,rationale,citations)
   SELECT r.repository_id,r.id,'ai',rec->>'componentKey',(rec->>'targetLevel')::int,rec->>'action',rec->>'rationale',COALESCE(rec->'citations','[]'::jsonb)
   FROM ai_recommendation_runs r CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(r.response->'recommendations')='array' THEN r.response->'recommendations' ELSE '[]'::jsonb END
   ) rec
   WHERE r.repository_id=$1 AND rec->>'componentKey' IS NOT NULL AND rec->>'action' IS NOT NULL
   AND rec->>'targetLevel' IN ('1','2','3')
   ON CONFLICT (run_id,component_key,target_level,action) DO NOTHING`,[repositoryId]);
  const items=await db.query(`SELECT i.*,COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at,d.id) FROM recommendation_decisions d WHERE d.recommendation_id=i.id),'[]'::jsonb) AS decisions,
   COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id) FROM recommendation_actions a WHERE a.recommendation_id=i.id),'[]'::jsonb) AS actions
   FROM recommendation_items i WHERE i.repository_id=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT 200`,[repositoryId]);
  const metrics=await db.query(`SELECT
   count(*)::int AS total,
   count(*) FILTER (WHERE status='accepted')::int AS accepted,
   count(*) FILTER (WHERE status='rejected')::int AS rejected,
   count(*) FILTER (WHERE status='deferred')::int AS deferred,
   count(*) FILTER (WHERE status='pending')::int AS pending
   FROM recommendation_items WHERE repository_id=$1`,[repositoryId]);
  const outcomes=await db.query(`SELECT count(*)::int AS recorded_outcomes,
   COALESCE(sum(a.defects_found),0)::int AS defects_found,
   count(*) FILTER (WHERE a.defects_found>0)::int AS actions_finding_defects
   FROM recommendation_actions a JOIN recommendation_items i ON i.id=a.recommendation_id
   WHERE i.repository_id=$1 AND a.outcome IS NOT NULL`,[repositoryId]);
  return json({items:items.rows,metrics:{...metrics.rows[0],...outcomes.rows[0]}});
 } catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
 try {
  const actor=requireOperator(request);
  if(Number(request.headers.get("content-length"))>8192)return json({error:"Request too large"},413);
  const parsed=command.safeParse(await request.json());
  if(!parsed.success)return json({error:"Invalid workflow request"},400);
  const input=parsed.data;
  if(!await enabled(input.repositoryId))return json({error:"Repository not configured or disabled"},404);
  const db=getDb();
  if(input.type==="seed"){
   const fixtures=[
    ["Authentication",2,"Add component tests for failed login and session expiry","Synthetic example: demonstrate how a product owner handles a test coverage recommendation."],
    ["Build pipeline",1,"Review static analysis rules for dependency changes","Synthetic example: demonstrate a deferred recommendation."],
    ["Release integration",3,"Add a system-level smoke test before release","Synthetic example: demonstrate linking an accepted recommendation to a test action."]
   ];
   for(const [component,levelAction,action,rationale] of fixtures){
    const level=Number(levelAction);
    await db.query(`INSERT INTO recommendation_items(repository_id,source,component_key,target_level,action,rationale)
     SELECT $1,'demo',$2,$3,$4,$5 WHERE NOT EXISTS
     (SELECT 1 FROM recommendation_items WHERE repository_id=$1 AND source='demo' AND component_key=$2 AND target_level=$3 AND action=$4)`,
     [input.repositoryId,component,level,action,rationale]);
   }
   return json({ok:true});
  }
  if(input.type==="decide"){
   const client=await db.connect();
   try{
    await client.query("BEGIN");
    const item=await client.query("SELECT id FROM recommendation_items WHERE id=$1 AND repository_id=$2 FOR UPDATE",[input.id,input.repositoryId]);
    if(!item.rowCount){await client.query("ROLLBACK");return json({error:"Recommendation not found"},404);}
    await client.query("UPDATE recommendation_items SET status=$1 WHERE id=$2",[input.decision,input.id]);
    await client.query("INSERT INTO recommendation_decisions(recommendation_id,actor,decision,rationale) VALUES($1,$2,$3,$4)",[input.id,actor,input.decision,input.rationale]);
    await client.query("COMMIT");return json({ok:true});
   }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  if(input.type==="action"){
   const item=await db.query("SELECT 1 FROM recommendation_items WHERE id=$1 AND repository_id=$2 AND status='accepted'",[input.id,input.repositoryId]);
   if(!item.rowCount)return json({error:"Accept the recommendation before planning an action"},409);
   await db.query("INSERT INTO recommendation_actions(recommendation_id,description,created_by) VALUES($1,$2,$3)",[input.id,input.description,actor]);
   return json({ok:true});
  }
  const updated=await db.query(`UPDATE recommendation_actions a SET outcome=$1,defects_found=$2,updated_at=now()
   FROM recommendation_items i WHERE a.id=$3 AND a.recommendation_id=i.id AND i.repository_id=$4 RETURNING a.id`,
   [input.outcome,input.defectsFound,input.actionId,input.repositoryId]);
  return updated.rowCount?json({ok:true}):json({error:"Action not found"},404);
 }catch(e){return errorResponse(e);}
}
