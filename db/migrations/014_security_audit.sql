-- Preserve access-control history independently of current roles/grants.
CREATE TABLE security_audit (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  github_user_id bigint NOT NULL,
  repository_id bigint,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION audit_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior jsonb;
  next_value jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN prior := to_jsonb(OLD) - 'token_hash'; END IF;
  IF TG_OP <> 'DELETE' THEN next_value := to_jsonb(NEW) - 'token_hash'; END IF;
  INSERT INTO security_audit(actor,action,github_user_id,repository_id,before_value,after_value)
  VALUES (COALESCE(NULLIF(current_setting('orbit.actor', true), ''), 'database:' || session_user),
    TG_TABLE_NAME || '.' || lower(TG_OP),
    COALESCE(next_value->>'github_user_id', prior->>'github_user_id')::bigint,
    COALESCE(next_value->>'repository_id', prior->>'repository_id')::bigint, prior, next_value);
  RETURN NULL;
END;
$$;
CREATE TRIGGER audit_roles AFTER INSERT OR UPDATE OR DELETE ON orbit_user_roles
  FOR EACH ROW EXECUTE FUNCTION audit_access_change();
CREATE TRIGGER audit_grants AFTER INSERT OR UPDATE OR DELETE ON orbit_repository_grants
  FOR EACH ROW EXECUTE FUNCTION audit_access_change();
CREATE TRIGGER audit_sessions AFTER INSERT OR UPDATE OR DELETE ON orbit_auth_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_access_change();

-- Audit rows are append-only for normal SQL operations. The database owner still
-- controls DDL; production uses a separate migration role (see security runbook).
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only';
END;
$$;
CREATE TRIGGER security_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON security_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
