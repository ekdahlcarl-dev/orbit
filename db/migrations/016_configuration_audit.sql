ALTER TABLE security_audit ALTER COLUMN github_user_id DROP NOT NULL;

CREATE FUNCTION audit_configuration_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior jsonb;
  next_value jsonb;
  repo bigint;
BEGIN
  -- Provider configuration is deliberately excluded: credentials belong in the
  -- environment, and audit history must never become a secondary secret store.
  IF TG_OP <> 'INSERT' THEN prior := to_jsonb(OLD) - 'config' - 'configuration'; END IF;
  IF TG_OP <> 'DELETE' THEN next_value := to_jsonb(NEW) - 'config' - 'configuration'; END IF;
  repo := COALESCE(next_value->>'repository_id', prior->>'repository_id')::bigint;
  IF TG_TABLE_NAME = 'system_test_environments' THEN
    SELECT repository_id INTO repo FROM system_test_providers
      WHERE id=COALESCE(next_value->>'provider_id', prior->>'provider_id')::bigint;
  END IF;
  INSERT INTO security_audit(actor,action,github_user_id,repository_id,before_value,after_value)
  VALUES (COALESCE(NULLIF(current_setting('orbit.actor', true), ''), 'database:' || session_user),
    TG_TABLE_NAME || '.' || lower(TG_OP), NULLIF(current_setting('orbit.github_user_id', true), '')::bigint,
    repo, prior, next_value);
  RETURN NULL;
END;
$$;
CREATE TRIGGER audit_static_requirements AFTER INSERT OR UPDATE OR DELETE ON static_analysis_requirements
  FOR EACH ROW EXECUTE FUNCTION audit_configuration_change();
CREATE TRIGGER audit_confidence_requirements AFTER INSERT OR UPDATE OR DELETE ON confidence_requirements
  FOR EACH ROW EXECUTE FUNCTION audit_configuration_change();
CREATE TRIGGER audit_component_requirements AFTER INSERT OR UPDATE OR DELETE ON component_test_requirements
  FOR EACH ROW EXECUTE FUNCTION audit_configuration_change();
CREATE TRIGGER audit_system_requirements AFTER INSERT OR UPDATE OR DELETE ON system_test_requirements
  FOR EACH ROW EXECUTE FUNCTION audit_configuration_change();
CREATE TRIGGER audit_system_providers AFTER INSERT OR UPDATE OR DELETE ON system_test_providers
  FOR EACH ROW EXECUTE FUNCTION audit_configuration_change();
CREATE TRIGGER audit_system_environments AFTER INSERT OR UPDATE OR DELETE ON system_test_environments
  FOR EACH ROW EXECUTE FUNCTION audit_configuration_change();
