ALTER TABLE github_repositories
  ADD COLUMN event_builds boolean NOT NULL DEFAULT true,
  ADD COLUMN schedule_interval_minutes integer CHECK (schedule_interval_minutes IS NULL OR schedule_interval_minutes >= 5),
  ADD COLUMN next_scheduled_at timestamptz;

CREATE TABLE build_runs (
  id bigserial PRIMARY KEY,
  repository_id bigint NOT NULL,
  installation_id bigint NOT NULL,
  workflow_id bigint NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual','schedule','push')),
  trigger_key text NOT NULL UNIQUE,
  ref text NOT NULL,
  commit_sha text NOT NULL,
  github_run_id bigint UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX build_runs_repository_history ON build_runs (repository_id, requested_at DESC);
CREATE INDEX build_runs_match_github ON build_runs (repository_id, workflow_id, commit_sha, github_run_id);
CREATE INDEX github_repositories_schedule ON github_repositories (next_scheduled_at) WHERE enabled AND next_scheduled_at IS NOT NULL;
