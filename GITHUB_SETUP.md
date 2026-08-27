# ORB-3 GitHub onboarding

## Deployment prerequisites

This package implements onboarding, not workflow dispatch (ORB-4) or individual-user RBAC (ORB-14). It does not automatically create a GitHub App or change repository permissions.

1. Register a GitHub App in the account/organization that owns the repositories. Use **selected repositories**, not all repositories, when installing it.
2. Grant repository **Metadata: read**, **Contents: read** and **Actions: read**. No organization permissions, PATs or OAuth user tokens are required. ORB-4 must separately review Actions write before adding dispatch.
3. Subscribe to `push` and `workflow_run`. Installation and installation-repository events are delivered automatically.
4. Set the webhook URL to `https://<orbit-host>/api/github/webhook`. Leave SSL verification enabled. Set a random webhook secret of at least 32 characters.
5. Generate a private key and place it in the deployment's encrypted server secret store. Configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, literal newlines or escaped `\n`), `GITHUB_WEBHOOK_SECRET`, and comma-separated `GITHUB_ALLOWED_INSTALLATION_IDS`. Do not put keys into source, browser code or chat. Installation IDs are visible in the installation settings URL.
6. Configure `ORBIT_OPERATOR_USER` and a separate randomly generated `ORBIT_OPERATOR_PASSWORD` of at least 32 characters. Use HTTPS and restrict access to trusted operators (VPN/access gateway recommended). Add rate limiting at the gateway. This temporary single-operator account is not multi-user RBAC; all actions identify this configured operator. Replace the boundary in ORB-14 before a multi-user production rollout.
7. Run `npm ci` and `npm run db:migrate` with `DATABASE_URL` configured, then start both the application and `npm run worker`. Never use a mock GitHub transport in a deployed environment.
8. Open `/repositories`, enter the ORBIT operator credentials, choose an installation/repository, select a branch or tag and workflow, then save. Re-select the repository to edit its configuration.

No GitHub keys or installation tokens are sent to the browser. Operator credentials are entered by the operator and held only in page memory, not localStorage, sessionStorage or cookies. Refresh/navigation/disconnect clears page state. All API reads/writes authenticate first, and responses are non-cacheable. Environment configuration fails closed when missing.

## API and persistence

| Endpoint | Purpose |
| --- | --- |
| `GET /api/github/installations` | Active app installations filtered by server allowlist |
| `GET /api/github/repositories?installationId=…` | Live installation membership |
| `GET /api/github/options?installationId=…&repositoryId=…` | Branches, tags, active workflows |
| `GET /api/github/configurations?installationId=…` | Authorized persisted configuration |
| `POST /api/github/configurations` | Validate live GitHub membership/ref/workflow, save and audit atomically |
| `GET /api/github/audit?installationId=…` | Most recent 100 authorized audit records |
| `POST /api/github/webhook` | HMAC-verified durable event intake, no operator login |

Configuration body: `{ "installationId": 123, "repositoryId": 456, "ref": "heads/main", "workflowId": 789, "enabled": false }`. Refs use `heads/…` or `tags/…` to avoid branch/tag ambiguity. GitHub validates that the workflow file exists on that ref. Dispatch compatibility (`workflow_dispatch`) is deliberately deferred to ORB-4.

Migration `002_github_onboarding.sql` adds `github_repositories`, `github_audit`, and `github_deliveries`. A configuration upsert and its before/after audit snapshot share a transaction and a per-repository advisory lock. The database contains installation references and configuration, never GitHub access tokens/private keys.

Discovery paginates up to 10,000 results and fails explicitly beyond that limit. Membership is checked against installation repositories, not just whether a token can read a public repository. Configuration/audit reads are filtered by live installation membership. Consequently, revoked repositories are hidden from these UI reads; their revocation audit remains retained for privileged database/security operations.

## Webhook and worker behavior

HMAC-SHA256 validates the **raw bytes** before parsing. Payloads are limited to 1 MiB. Only approved installations and onboarded repository IDs are accepted for repository events. Unsupported event types are acknowledged as ignored. Unknown JSON fields are discarded; only minimal identifiers/run metadata are retained. No logs, source content or tokens are ingested here.

Delivery ID is a database primary key. Delivery insertion and queue insertion are atomic, so concurrent duplicates create exactly one job. Keep delivery IDs for the installation lifetime: GitHub signatures have no signed timestamp, so durable ID retention is the replay defense. Do not prune IDs without introducing a separate durable deduplication ledger.

The worker uses `FOR UPDATE SKIP LOCKED` and one database transaction for claim, processing and completion. A crash rolls back the claim; failed jobs retry at 30-second intervals, up to three attempts, then remain `failed` for operator inspection. Unknown job types are marked failed rather than incorrectly reported as succeeded. Requeue only after diagnosing the cause.

Installation deletion/suspension and repository removal disable affected configurations and audit before/after state. Reinstallation/unsuspension never automatically re-enables builds; an operator must explicitly revalidate and save. Delayed revocation events err on the side of disabling access. All future dispatch code must revalidate live access at execution time; webhook delivery alone is not a sufficient authorization check.

`push` and `workflow_run` metadata is persisted and audited for ORB-4; processing in this package does not start builds or assign confidence levels.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. With `DATABASE_URL`, tests create and drop an isolated schema to check real PostgreSQL transactions, rollback, deduplication, revocation and worker retries. Without PostgreSQL, that integration test explicitly skips. ORBIT CI provides PostgreSQL and runs migration replay and all checks.

Live acceptance after configuring the App: discover an allowed repository; save and reload its ref/workflow; reject a repository not installed for the App; deliver and redeliver a signed webhook (one job only); remove repository access and verify it is unavailable. Live acceptance requires the operator's App setup and is distinct from mocked HTTP tests.

## API references

- [GitHub installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
