CREATE TABLE recommendation_items (
 id bigserial PRIMARY KEY,
 repository_id bigint NOT NULL REFERENCES github_repositories(repository_id) ON DELETE CASCADE,
 run_id bigint REFERENCES ai_recommendation_runs(id) ON DELETE SET NULL,
 source text NOT NULL CHECK(source IN ('demo','ai')),
 component_key text NOT NULL,
 target_level integer NOT NULL CHECK(target_level BETWEEN 1 AND 3),
 action text NOT NULL,
 rationale text NOT NULL,
 citations jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','deferred')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id, component_key, target_level, action)
);
CREATE INDEX recommendation_items_repo_idx ON recommendation_items(repository_id, created_at DESC);
CREATE TABLE recommendation_decisions (
 id bigserial PRIMARY KEY,
 recommendation_id bigint NOT NULL REFERENCES recommendation_items(id) ON DELETE CASCADE,
 actor text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('accepted','rejected','deferred')),
 rationale text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recommendation_actions (
 id bigserial PRIMARY KEY,
 recommendation_id bigint NOT NULL REFERENCES recommendation_items(id) ON DELETE CASCADE,
 description text NOT NULL,
 outcome text,
 defects_found integer CHECK(defects_found >= 0),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
