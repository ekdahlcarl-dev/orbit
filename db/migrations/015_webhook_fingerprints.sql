-- Hash the complete canonical signed JSON while retaining only the allowlisted
-- processing fields in payload. Legacy deliveries deliberately retain NULL:
-- their original signed fields cannot be reconstructed, so retries fail closed.
ALTER TABLE github_deliveries ADD COLUMN payload_fingerprint text
  CHECK (payload_fingerprint IS NULL OR payload_fingerprint ~ '^[a-f0-9]{64}$');

-- App-level pings have a signed hook.app_id rather than an installation.
ALTER TABLE github_deliveries ALTER COLUMN installation_id DROP NOT NULL;
ALTER TABLE github_audit ALTER COLUMN installation_id DROP NOT NULL;
