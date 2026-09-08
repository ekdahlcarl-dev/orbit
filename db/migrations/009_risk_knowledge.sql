CREATE TABLE knowledge_components (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'component' CHECK (kind IN ('component','module','service','capability')),
  parent_id bigint REFERENCES knowledge_components(id),
  criticality smallint NOT NULL DEFAULT 3 CHECK (criticality BETWEEN 1 AND 5),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repository_id,key)
);
CREATE INDEX knowledge_components_parent ON knowledge_components(parent_id);

CREATE TABLE knowledge_dependencies (
  from_component_id bigint NOT NULL REFERENCES knowledge_components(id) ON DELETE CASCADE,
  to_component_id bigint NOT NULL REFERENCES knowledge_components(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'depends_on',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(from_component_id,to_component_id,relationship),
  CHECK(from_component_id <> to_component_id)
);
CREATE INDEX knowledge_dependencies_reverse ON knowledge_dependencies(to_component_id,from_component_id);

CREATE TABLE knowledge_commit_components (
  repository_id bigint NOT NULL,
  commit_sha text NOT NULL,
  component_id bigint NOT NULL REFERENCES knowledge_components(id) ON DELETE CASCADE,
  files_changed integer NOT NULL DEFAULT 0 CHECK(files_changed >= 0),
  lines_added integer NOT NULL DEFAULT 0 CHECK(lines_added >= 0),
  lines_deleted integer NOT NULL DEFAULT 0 CHECK(lines_deleted >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(repository_id,commit_sha,component_id)
);
CREATE INDEX knowledge_commit_lookup ON knowledge_commit_components(repository_id,commit_sha);

CREATE TABLE knowledge_test_components (
  component_id bigint NOT NULL REFERENCES knowledge_components(id) ON DELETE CASCADE,
  test_key text NOT NULL,
  level smallint NOT NULL CHECK(level IN (1,2,3)),
  capability_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(component_id,test_key,level)
);

CREATE TABLE knowledge_features (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  feature_key text NOT NULL,
  title text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(repository_id,feature_key)
);
CREATE TABLE knowledge_feature_components (
  feature_id bigint NOT NULL REFERENCES knowledge_features(id) ON DELETE CASCADE,
  component_id bigint NOT NULL REFERENCES knowledge_components(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'implemented_by',
  PRIMARY KEY(feature_id,component_id,relationship)
);

CREATE TABLE component_risk_snapshots (
  id bigserial PRIMARY KEY,
  component_id bigint NOT NULL REFERENCES knowledge_components(id) ON DELETE CASCADE,
  repository_id bigint NOT NULL,
  score numeric(5,2) NOT NULL CHECK(score BETWEEN 0 AND 100),
  signals jsonb NOT NULL,
  model_version text NOT NULL DEFAULT 'orbit-risk-v1',
  calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX component_risk_latest ON component_risk_snapshots(component_id,calculated_at DESC);
