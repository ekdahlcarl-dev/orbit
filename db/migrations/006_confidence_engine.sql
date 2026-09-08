CREATE TABLE confidence_requirements (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  level smallint NOT NULL CHECK (level IN (2,3)),
  key text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  max_age_minutes integer CHECK (max_age_minutes IS NULL OR max_age_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repository_id, level, key)
);

CREATE TABLE confidence_evidence_state (
  id bigserial PRIMARY KEY,
  artifact_id bigint NOT NULL REFERENCES artifacts(id),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  repository_id bigint NOT NULL,
  level smallint NOT NULL CHECK (level IN (2,3)),
  key text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','running','passed','failed')),
  evidence_id bigint REFERENCES evidence(id),
  observed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id, level, key)
);
CREATE INDEX confidence_evidence_lookup ON confidence_evidence_state(artifact_id, level, key);

CREATE TABLE confidence_current (
  artifact_id bigint PRIMARY KEY REFERENCES artifacts(id),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  repository_id bigint NOT NULL,
  commit_sha text NOT NULL,
  confidence_level smallint NOT NULL CHECK (confidence_level BETWEEN 0 AND 3),
  level_1_state text NOT NULL,
  level_2_state text NOT NULL,
  level_3_state text NOT NULL,
  snapshot jsonb NOT NULL,
  source text NOT NULL DEFAULT 'deterministic-engine' CHECK (source = 'deterministic-engine'),
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE confidence_transitions (
  id bigserial PRIMARY KEY,
  artifact_id bigint NOT NULL REFERENCES artifacts(id),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  from_level smallint CHECK (from_level BETWEEN 0 AND 3),
  to_level smallint NOT NULL CHECK (to_level BETWEEN 0 AND 3),
  from_states jsonb,
  to_states jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  source text NOT NULL DEFAULT 'deterministic-engine' CHECK (source = 'deterministic-engine'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX confidence_transitions_artifact ON confidence_transitions(artifact_id, created_at DESC);
