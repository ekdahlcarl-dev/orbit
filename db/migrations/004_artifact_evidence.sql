CREATE TABLE artifacts (
  id bigserial PRIMARY KEY,
  digest_algorithm text NOT NULL CHECK (digest_algorithm IN ('sha256','sha512')),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]+$'),
  name text NOT NULL,
  media_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  repository_id bigint NOT NULL,
  commit_sha text NOT NULL,
  storage_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (digest_algorithm, digest)
);
CREATE INDEX artifacts_build_lineage ON artifacts (build_run_id, repository_id, commit_sha);

CREATE TABLE evidence (
  id bigserial PRIMARY KEY,
  artifact_id bigint REFERENCES artifacts(id),
  build_run_id bigint NOT NULL REFERENCES build_runs(id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('test','static_analysis','other')),
  format text NOT NULL CHECK (format IN ('junit','orbit-json')),
  source text NOT NULL,
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  raw_storage_ref text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','failed','error','skipped','unknown')),
  summary jsonb NOT NULL,
  provenance jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_source_identity UNIQUE NULLS NOT DISTINCT (source_digest, build_run_id, artifact_id)
);
CREATE INDEX evidence_artifact ON evidence (artifact_id, ingested_at DESC);
CREATE INDEX evidence_build ON evidence (build_run_id, ingested_at DESC);

CREATE TABLE evidence_quarantine (
  id bigserial PRIMARY KEY,
  build_run_id bigint,
  artifact_digest text,
  source text NOT NULL,
  reason text NOT NULL,
  raw_storage_ref text,
  received_at timestamptz NOT NULL DEFAULT now()
);