CREATE TABLE component_test_requirements (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  component_key text NOT NULL,
  suite_key text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  max_age_minutes integer CHECK (max_age_minutes IS NULL OR max_age_minutes > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repository_id,component_key,suite_key)
);

CREATE TABLE component_test_results (
  id bigserial PRIMARY KEY,
  artifact_id bigint NOT NULL REFERENCES artifacts(id),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  repository_id bigint NOT NULL,
  commit_sha text NOT NULL,
  component_key text NOT NULL,
  suite_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','running','passed','failed','unstable')),
  evidence_id bigint NOT NULL REFERENCES evidence(id),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  flaky_tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id,component_key,suite_key,evidence_id)
);

CREATE INDEX component_test_results_artifact ON component_test_results(artifact_id,component_key,suite_key,observed_at DESC);
