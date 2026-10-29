# ORB-14 security review and operating runbook

ORB-19 adds a [telemetry data-protection contract](architecture/telemetry-contract-v1.md) and [receiver operating guidance](otel-runbook.md). It preserves this runbook's safe error serialization, secret handling and live role/repository-grant checks. The new telemetry architecture does not change authentication, permissions or audit behavior; application enforcement is assigned to ORB-20–26.

Reviewed on 2026-10-25. This completion branch builds on PR #24 (merged at 10:49:56 UTC, merge commit `274c683fcd40d80210f83777df1988a2cc5342dc`). It is not authorization to merge or release.

## Acceptance evidence

| Acceptance criterion | Implementation and verification |
| --- | --- |
| Users access only authorized capabilities/repositories | GitHub OAuth, single-use database-backed state, opaque hashed/revocable sessions, deny-by-default role and repository grants. Added protected-route coverage and fixed missing authorization on confidence GET status/history. PostgreSQL tests cover new users, viewer/product-owner build denial, admin repository isolation and CSRF. |
| Integration secrets never exposed to clients | Credentials remain server environment variables; no `NEXT_PUBLIC_` secret settings. Webhook persistence contains allowlisted fields plus a SHA-256 fingerprint of the complete canonical payload, not arbitrary signed fields. Session tokens/hashes are excluded from audit rows. Provider config rejects credential fields and credential-bearing URLs; run reads omit environment configuration. Logs omit bearer fields, job payloads and raw upstream/database error details. |
| Privileged build/config actions require roles | Admin role and explicit repository grants gate build/config mutations. Product owners can decide recommendations; viewers can read. Resource ownership is resolved server-side. |
| Critical actions/changes are auditable | Existing repository config, build dispatch, confidence-transition and recommendation-decision histories retained. Added atomic build settings/request audit writes, transaction-bound API actor identities, configuration triggers, role/grant/session lifecycle triggers and admin-only `/api/auth/audit`. Security audit rejects UPDATE/DELETE/TRUNCATE. |
| Replay and malicious-report scenarios tested | Tests cover HMAC failures, conflicting full-payload fingerprints, identical retries, app and installation pings, ignored events, repository/installation denial, eight concurrent PostgreSQL deliveries, and rollback/retry after audit failure. Strict XML parsing rejects malformed XML, DTDs, unknown entities, nested testcases and excessive nesting/results/size. Comments cannot fabricate testcase results. |
| Security checks in CI before release | CI adds a high/critical dependency gate and Gitleaks history scan alongside typecheck/lint/build and all database-backed tests. Maintainers must require these checks in branch rules before release. |

## Verification

The final automated run passed 74 tests with no skips against the isolated `orbit_security_final` PostgreSQL database, including the real OAuth callback route with mocked GitHub HTTP responses. Typecheck and lint passed. Dependency audit reported zero vulnerabilities after compatible lockfile updates and a PostCSS override. The production build passed.

The test runner now loads each TypeScript test explicitly. In this environment the previous subprocess runner could report file-level success without registering individual test cases; the replacement reports all named cases and includes every `src/**/*.test.ts` file.

Real GitHub OAuth interaction, proxy/browser cookie behavior, and live GitHub redelivery still require the GUI checks below. Do not interpret mocked provider responses as a live OAuth test. CI and manual results must correspond to the PR's current head.

## Threat model

Assets: repository/test-evidence confidentiality, deterministic confidence integrity, privileged build dispatch, user sessions, integration credentials, and audit history. Actors: anonymous callers, authenticated viewers/product owners/admins, GitHub, untrusted report producers and external AI providers. Administrators and the database owner are trusted; compromising either is outside the repository-isolation boundary.

| Boundary / threat | Controls | Residual considerations |
| --- | --- | --- |
| Browser → API: impersonation, IDOR, CSRF | Database session lookup, current role/grant lookup, server-resolved resource ownership, exact configured origin on mutations, HttpOnly/Secure/SameSite cookies | Production requires HTTPS and a correct `ORBIT_PUBLIC_URL`; development proxy origin exception is limited to Codespaces/development/port 3001. |
| OAuth → session: callback injection/replay | Signed bounded state, exact matching state cookie, atomic nonce consumption, GitHub identity lookup, eight-hour revocable opaque sessions | Provider account security remains GitHub's responsibility. Role removal takes effect on the next request. |
| GitHub → webhook: forgery/replay | Exact-byte HMAC, bounded body, installation/repository checks, full canonical JSON fingerprint, unique delivery ID, transactional job/audit insertion | App-level ping has no installation: signed `hook.app_id` must match `GITHUB_APP_ID`; it never queues work. Ignored events are persisted/audited without jobs. Different delivery IDs are distinct deliveries; TLS and the webhook secret protect delivery metadata in transit. |
| Reports → normalized evidence: forged success, XXE, resource exhaustion, XSS | Structural XML parsing, no DTD/entity resolution, size/depth/result limits, strict JSON contracts, server-side lineage checks, text rendering in React | These controls validate structure and provenance, not whether a trusted producer's asserted test outcome is truthful. |
| API/worker → database: SQL injection and lost audit history | Parameterized SQL, transaction-local audit actors, audit triggers, atomic settings/request/webhook writes, runtime least privilege | Database owners can alter triggers/DDL. Use a separate production migration owner and externally retain backups/logs. |
| Evidence → AI: prompt injection/overreach | Repository-scoped retrieval, evidence citation validation, human decision workflow, no AI write path to deterministic confidence | AI output remains interpretation. Provider credentials remain server-side; only approved evidence should be sent to the provider. |
| Dependencies and git history → release | Dependency audit, Gitleaks, security regressions and general CI gates | Scanners are not proof of absence; review dependency changes and require current-head CI. |

## Migration and compatibility

Apply migrations 014–016 before starting the updated web process and worker. They add security audit/triggers and complete-payload webhook fingerprints; existing business data is retained. Re-running the migration command is safe because applied versions are recorded.

Old deliveries lack the original signed fields, so their new fingerprint column remains NULL. Reusing such an ID returns 409 and never requeues work. Do not fabricate fingerprints from stripped historical payloads. A new post-upgrade delivery establishes the replay record; verify that delivery's redelivery in the GUI. Previously accepted jobs remain processable.

GitHub app-level pings now require a matching signed app ID when no installation is present. Unknown installation events fail closed. New ignored/ping deliveries are marked processed immediately and create no worker jobs.

## Secrets storage and rotation

Production credentials must come from an encrypted hosting secret store or managed secret manager, with encryption at rest and TLS in transit. Local `.env.local`, PEM and key files remain ignored and must not be uploaded, logged or included in artifacts. Restrict local secret files to the operator account. Provider configuration contains public metadata or environment variable names such as `apiKeyEnv: LAB_API_KEY`; adapters resolve credentials only on the server. Never place credentials in URLs, report metadata, audit notes or AI prompts.

Maintain an inventory (owner, purpose, environment, last rotation date and revocation path) for the GitHub App private key, webhook secret, OAuth client secret, `ORBIT_AUTH_SECRET`, database credentials and AI-provider key. Rotate on suspected exposure, staff/access changes and the organization's scheduled interval. Record only key IDs/dates/ticket references, never secret values.

Rotation procedure:

1. Create the replacement credential in its provider, update the encrypted environment configuration, and restart/redeploy both web and worker. Keep previous credentials only during the shortest necessary provider-supported overlap.
2. Verify the affected path: OAuth sign-in/callback for OAuth/auth state secrets, a newly signed webhook for webhook secrets, repository lookup/build dispatch for App keys, database health for DB credentials, and an approved non-sensitive AI request for provider credentials.
3. Revoke the old provider credential, verify it fails, and record the result. Webhook validation currently supports one secret; coordinate the GitHub secret update and app restart, then redeliver failures. Rotation of `ORBIT_AUTH_SECRET` invalidates pending OAuth states, not existing opaque sessions.
4. For session compromise, revoke the affected user's sessions (`UPDATE orbit_auth_sessions SET revoked_at=now() WHERE github_user_id=... AND revoked_at IS NULL`) in an identified/audited transaction. For broad compromise revoke all active sessions, rotate affected integration keys and require fresh login.

This change documents and tests the controls; it does not rotate live credentials without a coordinated operational change.

## Production database privilege boundary

Use a migration owner separate from the web/worker runtime role. The runtime role must not be a superuser, table owner, or member of the migration role. Grant only schema usage, required table DML and sequence usage; deny schema creation and all migration-table access. Remove UPDATE/DELETE/TRUNCATE on `security_audit`, `github_audit`, `recommendation_decisions` and `confidence_transitions`. The runtime needs INSERT/SELECT on audit tables for application/trigger operations. Reapply reviewed grants after migrations; do not grant ownership or DDL to make migrations work from the app.

Initial role/grant provisioning and changes use the migration/operator connection and an identified transaction, for example:

```sql
BEGIN;
SELECT set_config('orbit.actor', 'operator:CHANGE-TICKET:OPERATOR-ID', true);
INSERT INTO orbit_user_roles(github_user_id, role) VALUES (12345, 'admin')
  ON CONFLICT (github_user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=now();
INSERT INTO orbit_repository_grants(github_user_id, repository_id) VALUES (12345, 67890)
  ON CONFLICT DO NOTHING;
COMMIT;
```

Replace the sample IDs with verified GitHub identities/repositories. There are no default administrators. Database triggers record inserts/updates/deletes, including direct SQL changes and cascading grant removal. The admin onboarding endpoint can grant only repositories exposed by an allowed live installation. Admin management of other users' grants remains ORB-17; no additional GUI is required for ORB-14's authorization boundary.

## GUI verification before merge/release

Use this branch with migrations applied and both web/worker running against the intended development or preview environment.

1. Sign in via GitHub, finish the real callback, and confirm the dashboard loads only granted repositories. Confirm Sign out works behind the public proxy and refreshing cannot restore access.
2. With a viewer/product-owner account, confirm build/config API mutations are forbidden; with an admin, confirm an ungranted repository is still forbidden. Check `/api/auth/audit` as an admin for role/grant/session/config records; other roles must get 403.
3. In the GitHub App's **Advanced → Recent deliveries**, choose a new post-upgrade delivery, verify successful receipt, redeliver it, and confirm a duplicate response with no second queue job/build or receipt-audit row. Also check app ping succeeds and an ignored event queues no work.
4. Confirm the PR's current-head quality and security jobs pass. Check branch rules require both; merge only with the owner's explicit consent.

Record the environment, PR head, date and result. Do not paste cookies, bearer tokens or provider secrets into the PR or Linear.

References: [GitHub webhook payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [Saxes parsing behavior](https://github.com/lddubeau/saxes), [Gitleaks action](https://github.com/gitleaks/gitleaks-action).
