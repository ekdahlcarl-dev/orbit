import type { Pool } from "pg";
import { rankComponentRisk } from "./risk";

export type ConfidenceTarget = 1 | 2 | 3;
export type EvidenceCitation = { id: number; sourceType: string; sourceRef: string; excerpt: string };
export type TestRecommendation = { componentKey: string; targetLevel: ConfidenceTarget; action: string; rationale: string; uncertainty: "low"|"medium"|"high"; citations: EvidenceCitation[] };
export type AssistantAnswer = { answer: string; recommendations: TestRecommendation[] };
export interface LlmProvider { readonly name:string; readonly model:string; complete(input:{question:string;context:unknown}):Promise<AssistantAnswer> }
export type RetrievalContext = { repositoryId:number; artifactId?:number; componentId?:number; since?:Date; limit?:number };

function cosine(a:number[],b:number[]){if(a.length!==b.length||!a.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return aa&&bb?dot/(Math.sqrt(aa)*Math.sqrt(bb)):0}

export async function indexEvidenceChunk(db:Pool,input:{repositoryId:number;artifactId?:number;componentId?:number;evidenceId?:number;sourceType:string;sourceRef:string;content:string;metadata?:Record<string,unknown>;observedAt?:Date;embedding?:number[]}){
 return (await db.query(`INSERT INTO ai_evidence_chunks(repository_id,artifact_id,component_id,evidence_id,source_type,source_ref,content,metadata,observed_at,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(repository_id,source_type,source_ref) DO UPDATE SET artifact_id=excluded.artifact_id,component_id=excluded.component_id,evidence_id=excluded.evidence_id,content=excluded.content,metadata=excluded.metadata,observed_at=excluded.observed_at,embedding=excluded.embedding RETURNING id`,[input.repositoryId,input.artifactId??null,input.componentId??null,input.evidenceId??null,input.sourceType,input.sourceRef,input.content,input.metadata??{},input.observedAt??new Date(),input.embedding??null])).rows[0];
}

export async function indexRepositoryEvidence(db:Pool,repositoryId:number){
 const rows=(await db.query(`SELECT e.id,e.artifact_id,e.evidence_type,e.source,e.status,e.summary,e.provenance,e.raw_storage_ref,e.ingested_at FROM evidence e JOIN artifacts a ON a.id=e.artifact_id WHERE a.repository_id=$1 ORDER BY e.ingested_at DESC`,[repositoryId])).rows;
 for(const e of rows){await indexEvidenceChunk(db,{repositoryId,artifactId:Number(e.artifact_id),evidenceId:Number(e.id),sourceType:e.evidence_type,sourceRef:e.raw_storage_ref,content:`${e.source} status ${e.status}. Summary: ${JSON.stringify(e.summary)}. Provenance: ${JSON.stringify(e.provenance)}`,metadata:{status:e.status,source:e.source},observedAt:new Date(e.ingested_at)})}
 return rows.length;
}

export async function retrieveEvidence(db:Pool,question:string,context:RetrievalContext,queryEmbedding?:number[]){
 const limit=Math.max(1,Math.min(context.limit??12,50));
 const rows=(await db.query(`SELECT id,source_type,source_ref,content,metadata,observed_at,embedding,ts_rank_cd(search_vector,websearch_to_tsquery('english',$1)) text_rank FROM ai_evidence_chunks WHERE repository_id=$2 AND ($3::bigint IS NULL OR artifact_id=$3) AND ($4::bigint IS NULL OR component_id=$4) AND ($5::timestamptz IS NULL OR observed_at >= $5) ORDER BY text_rank DESC,observed_at DESC LIMIT 100`,[question,context.repositoryId,context.artifactId??null,context.componentId??null,context.since??null])).rows;
 return rows.map(r=>({id:Number(r.id),sourceType:String(r.source_type),sourceRef:String(r.source_ref),content:String(r.content),metadata:r.metadata,observedAt:r.observed_at,textRank:Number(r.text_rank??0),semanticRank:queryEmbedding&&Array.isArray(r.embedding)?cosine(queryEmbedding,r.embedding.map(Number)):null})).sort((a,b)=>(b.textRank+(b.semanticRank??0))-(a.textRank+(a.semanticRank??0))).slice(0,limit);
}

export async function recommendTesting(db:Pool,provider:LlmProvider,question:string,context:RetrievalContext,queryEmbedding?:number[]){
 await indexRepositoryEvidence(db,context.repositoryId);
 const evidence=await retrieveEvidence(db,question,context,queryEmbedding); const risks=await rankComponentRisk(db,context.repositoryId);
 const groundedContext={repositoryId:context.repositoryId,artifactId:context.artifactId??null,measuredEvidence:evidence.map(e=>({id:e.id,sourceType:e.sourceType,sourceRef:e.sourceRef,content:e.content,observedAt:e.observedAt})),derivedRiskAnalytics:risks.map(r=>({componentKey:r.component.key,score:r.score,signals:r.signals,modelVersion:r.modelVersion})),instruction:"Measured evidence and derived analytics are ORBIT facts. Label AI interpretation. Every recommendation must cite retrieved evidence ids. Never modify deterministic confidence state."};
 const response=await provider.complete({question,context:groundedContext}); const validIds=new Set(evidence.map(e=>e.id));
 for(const r of response.recommendations){if(![1,2,3].includes(r.targetLevel))throw new Error("AI recommendation has invalid confidence target");if(!r.citations.length||r.citations.some(c=>!validIds.has(c.id)))throw new Error("AI recommendation is not grounded in retrieved evidence")}
 await db.query(`INSERT INTO ai_recommendation_runs(repository_id,artifact_id,question,context,provider,model,prompt_version,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[context.repositoryId,context.artifactId??null,question,groundedContext,provider.name,provider.model,"orb-12-v1",response]); return {...response,evidence,risks};
}
