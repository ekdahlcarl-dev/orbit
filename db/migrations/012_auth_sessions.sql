-- ORB-14 Phase 1: OAuth replay prevention and revocable server-side sessions.
CREATE TABLE IF NOT EXISTS orbit_oauth_states (
  nonce_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS orbit_auth_sessions (
  token_hash text PRIMARY KEY,
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  github_login text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS orbit_auth_sessions_user_idx ON orbit_auth_sessions(github_user_id);
CREATE INDEX IF NOT EXISTS orbit_auth_sessions_expiry_idx ON orbit_auth_sessions(expires_at);
