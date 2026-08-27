CREATE TABLE github_repositories (
  repository_id bigint PRIMARY KEY,
  installation_id bigint NOT NULL,
  full_name text NOT NULL,
  default_ref text NOT NULL,
  workflow_id bigint NOT NULL,
  workflow_path text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  access_status text NOT NULL DEFAULT 'active' CHECK (access_status IN ('active', 'revoked')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_repositories_installation ON github_repositories (installation_id);

CREATE TABLE github_audit (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  installation_id bigint NOT NULL,
  repository_id bigint,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE github_deliveries (
  delivery_id text PRIMARY KEY,
  event text NOT NULL,
  installation_id bigint NOT NULL,
  repository_id bigint,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
