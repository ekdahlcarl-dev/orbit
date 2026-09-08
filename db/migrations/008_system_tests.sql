CREATE TABLE system_test_providers (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  provider_key text NOT NULL,
  adapter_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repository_id,provider_key)
);

CREATE TABLE system_test_environments (
  id bigserial PRIMARY KEY,
  provider_id bigint NOT NULL REFERENCES system_test_providers(id),
  environment_key text NOT NULL,
  environment_type text NOT NULL CHECK (environment_type IN ('virtual','hardware')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id,environment_key)
);

CREATE TABLE system_test_requirements (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  provider_key text NOT NULL,
  environment_key text NOT NULL,
  suite_key text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  max_age_minutes integer CHECK (max_age_minutes IS NULL OR max_age_minutes > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repository_id,provider_key,environment_key,suite_key)
);

CREATE TABLE system_test_runs (
  id bigserial PRIMARY KEY,
  artifact_id bigint NOT NULL REFERENCES artifacts(id),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  repository_id bigint NOT NULL,
  commit_sha text NOT NULL,
  artifact_digest text NOT NULL,
  provider_id bigint NOT NULL REFERENCES system_test_providers(id),
  environment_id bigint NOT NULL REFERENCES system_test_environments(id),
  suite_key text NOT NULL,
  provider_run_id text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN ('queued','running','passed','failed','timed_out','canceled','incomplete')),
  evidence_id bigint REFERENCES evidence(id),
  started_at timestamptz,
  completed_at timestamptz,
  observed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id,provider_run_id,attempt)
);

CREATE INDEX system_test_runs_artifact ON system_test_runs(artifact_id,observed_at DESC);
CREATE INDEX system_test_runs_provider ON system_test_runs(provider_id,environment_id,suite_key,observed_at DESC);
