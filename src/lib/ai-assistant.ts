import type { Pool } from "pg";
import { rankComponentRisk } from "./risk";

export type ConfidenceTarget = 1 | 2 | 3;
export type EvidenceCitation = { id: number; sourceType: string; sourceRef: string; excerpt: string };
export type TestRecommendation = {
  componentKey: string;
  targetLevel: ConfidenceTarget;
  action: string;
  rationale: string;
  uncertainty: "low" | "medium" | "high";
  citations: EvidenceCitation[];
};
export type AssistantAnswer = { answer: string; recommendations: TestRecommendation[] };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(input: { question: string; context: unknown }): Promise<AssistantAnswer>;
}

export type RetrievalContext = {
  repositoryId: number;
  artifactId?: number;
  componentId?: number;
  since?: Date;
  limit?: number;
};

export async function indexEvidenceChunk(db: Pool, input: {
  repositoryId: number; artifactId?: number; componentId?: number; evidenceId?: number;
  sourceType: string; sourceRef: string; content: string; metadata?: Record<string, unknown>;
  observedAt?: Date; embedding?: number[];
}) {
  const embedding = input.embedding ? `[${input.embedding.join(",")}]` : null;
  return (await db.query(
    `INSERT INTO ai_evidence_chunks(repository_id,artifact_id,component_id,evidence_id,source_type,source_ref,content,metadata,observed_at,embedding)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector)
     ON CONFLICT(repository_id,source_type,source_ref) DO UPDATE SET
       artifact_id=excluded.artifact_id,component_id=excluded.component_id,evidence_id=excluded.evidence_id,
       content=excluded.content,metadata=excluded.metadata,observed_at=excluded.observed_at,embedding=excluded.embedding
     RETURNING id`, [input.repositoryId,input.artifactId ?? null,input.componentId ?? null,input.evidenceId ?? null,
       input.sourceType,input.sourceRef,input.content,input.metadata ?? {},input.observedAt ?? new Date(),embedding],
  )).rows[0];
}

export async function retrieveEvidence(db: Pool, question: string, context: RetrievalContext, queryEmbedding?: number[]) {
  const limit = Math.max(1, Math.min(context.limit ?? 12, 50));
  const embedding = queryEmbedding ? `[${queryEmbedding.join(",")}]` : null;
  const rows = (await db.query(
    `SELECT id,source_type,source_ref,content,metadata,observed_at,
       ts_rank_cd(search_vector,websearch_to_tsquery('english',$1)) AS text_rank,
       CASE WHEN $6::vector IS NULL OR embedding IS NULL THEN NULL ELSE 1-(embedding <=> $6::vector) END AS semantic_rank
     FROM ai_evidence_chunks
     WHERE repository_id=$2
       AND ($3::bigint IS NULL OR artifact_id=$3)
       AND ($4::bigint IS NULL OR component_id=$4)
       AND ($5::timestamptz IS NULL OR observed_at >= $5)
     ORDER BY (ts_rank_cd(search_vector,websearch_to_tsquery('english',$1)) +
       COALESCE(CASE WHEN $6::vector IS NULL OR embedding IS NULL THEN 0 ELSE 1-(embedding <=> $6::vector) END,0)) DESC,
       observed_at DESC LIMIT ${limit}`,
    [question,context.repositoryId,context.artifactId ?? null,context.componentId ?? null,context.since ?? null,embedding],
  )).rows;
  return rows.map((row) => ({
    id: Number(row.id), sourceType: row.source_type as string, sourceRef: row.source_ref as string,
    content: row.content as string, metadata: row.metadata, observedAt: row.observed_at,
    textRank: Number(row.text_rank ?? 0), semanticRank: row.semantic_rank == null ? null : Number(row.semantic_rank),
  }));
}

export async function recommendTesting(db: Pool, provider: LlmProvider, question: string, context: RetrievalContext, queryEmbedding?: number[]) {
  const evidence = await retrieveEvidence(db, question, context, queryEmbedding);
  const risks = await rankComponentRisk(db, context.repositoryId);
  const groundedContext = {
    repositoryId: context.repositoryId, artifactId: context.artifactId ?? null,
    measuredEvidence: evidence.map((e) => ({ id:e.id,sourceType:e.sourceType,sourceRef:e.sourceRef,content:e.content,observedAt:e.observedAt })),
    derivedRiskAnalytics: risks.map((r) => ({ componentKey:r.component.key,score:r.score,signals:r.signals,modelVersion:r.modelVersion })),
    instruction: "Measured evidence and derived analytics are facts supplied by ORBIT. AI interpretation must be labeled as interpretation. Cite evidence ids for every recommendation. Never modify or claim to modify deterministic confidence state.",
  };
  const response = await provider.complete({ question, context: groundedContext });
  const validIds = new Set(evidence.map((e) => e.id));
  for (const recommendation of response.recommendations) {
    if (![1,2,3].includes(recommendation.targetLevel)) throw new Error("AI recommendation has invalid confidence target");
    if (!recommendation.citations.length || recommendation.citations.some((c) => !validIds.has(c.id)))
      throw new Error("AI recommendation is not grounded in retrieved evidence");
  }
  await db.query(
    `INSERT INTO ai_recommendation_runs(repository_id,artifact_id,question,context,provider,model,prompt_version,response)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [context.repositoryId,context.artifactId ?? null,question,groundedContext,provider.name,provider.model,"orb-12-v1",response],
  );
  return { ...response, evidence, risks };
}
