CREATE TABLE static_analysis_requirements (
  repository_id bigint NOT NULL,
  provider text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, provider)
);

CREATE TABLE static_analysis_results (
  id bigserial PRIMARY KEY,
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  repository_id bigint NOT NULL,
  commit_sha text NOT NULL,
  provider text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','running','failed','passed')),
  quality_gate text NOT NULL CHECK (quality_gate IN ('pending','running','failed','passed')),
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_id bigint NOT NULL REFERENCES evidence(id),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (build_run_id, provider, source_digest)
);

CREATE INDEX static_analysis_results_build_provider
  ON static_analysis_results (build_run_id, provider, created_at DESC);
CREATE INDEX static_analysis_results_commit
  ON static_analysis_results (repository_id, commit_sha, created_at DESC);
