ALTER TABLE github_repositories ADD COLUMN merge_gate_refresh_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE merge_gate_policies (
  repository_id bigint NOT NULL REFERENCES github_repositories(repository_id),
  branch_pattern text NOT NULL,
  required_level integer NOT NULL CHECK (required_level BETWEEN 1 AND 3),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, branch_pattern)
);
CREATE TABLE merge_gate_checks (
  repository_id bigint NOT NULL REFERENCES github_repositories(repository_id),
  target_branch text NOT NULL,
  commit_sha text NOT NULL,
  check_run_id bigint NOT NULL,
  decision_digest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id,target_branch,commit_sha)
);
CREATE TABLE merge_gate_decisions (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  target_branch text NOT NULL,
  commit_sha text NOT NULL,
  check_run_id bigint NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merge_gate_history ON merge_gate_decisions(repository_id,commit_sha,created_at);
CREATE TRIGGER merge_gate_decisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON merge_gate_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
