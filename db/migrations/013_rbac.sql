-- ORB-14 Phase 1: deny-by-default identities and repository grants.
CREATE TABLE IF NOT EXISTS orbit_user_roles (
  github_user_id bigint PRIMARY KEY CHECK (github_user_id > 0),
  role text NOT NULL CHECK (role IN ('viewer', 'product_owner', 'admin')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orbit_repository_grants (
  github_user_id bigint NOT NULL REFERENCES orbit_user_roles(github_user_id) ON DELETE CASCADE,
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  PRIMARY KEY (github_user_id, repository_id)
);
CREATE INDEX IF NOT EXISTS orbit_repository_grants_repository_idx ON orbit_repository_grants(repository_id);
-- No default administrators: provision explicit identities through an audited admin process.
