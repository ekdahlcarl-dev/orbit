CREATE TABLE ai_evidence_chunks (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  artifact_id bigint REFERENCES artifacts(id) ON DELETE CASCADE,
  component_id bigint REFERENCES knowledge_components(id) ON DELETE SET NULL,
  evidence_id bigint REFERENCES evidence(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content,''))) STORED,
  embedding double precision[],
  UNIQUE(repository_id, source_type, source_ref)
);
CREATE INDEX ai_evidence_chunks_repo_idx ON ai_evidence_chunks(repository_id, observed_at DESC);
CREATE INDEX ai_evidence_chunks_fts_idx ON ai_evidence_chunks USING gin(search_vector);

CREATE TABLE ai_recommendation_runs (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  artifact_id bigint REFERENCES artifacts(id) ON DELETE SET NULL,
  question text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_recommendation_runs_repo_idx ON ai_recommendation_runs(repository_id, created_at DESC);
