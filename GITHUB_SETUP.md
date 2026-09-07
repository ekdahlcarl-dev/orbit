# ORBIT GitHub integration and build orchestration

## Deployment prerequisites

ORBIT uses a GitHub App for repository onboarding and GitHub Actions workflow dispatch. Individual-user RBAC remains in ORB-14.

1. Register a GitHub App in the account/organization that owns the repositories. Use **selected repositories**, not all repositories, when installing it.
2. Grant repository **Metadata: read**, **Contents: read** and **Actions: write**. Actions write is required for `workflow_dispatch`; ORBIT requests short-lived installation tokens with only these permissions.
3. Subscribe to `push` and `workflow_run`. Installation and installation-repository events are delivered automatically.
4. Set the webhook URL to `https://<orbit-host>/api/github/webhook`. Leave SSL verification enabled. Set a random webhook secret of at least 32 characters.
5. Generate a private key and place it in the deployment's encrypted server secret store. Configure `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, literal newlines or escaped `\n`), `GITHUB_WEBHOOK_SECRET`, and comma-separated `GITHUB_ALLOWED_INSTALLATION_IDS`. Do not put keys into source, browser code or chat.
6. Configure `ORBIT_OPERATOR_USER` and a separate randomly generated `ORBIT_OPERATOR_PASSWORD` of at least 32 characters. Use HTTPS and restrict access to trusted operators. This temporary single-operator account is replaced by ORB-14 RBAC.
7. Run `npm ci` and `npm run db:migrate` with `DATABASE_URL` configured, then start both the application and `npm run worker`.
8. Open `/repositories`, choose an installation/repository, select a branch or tag and an **active workflow that supports `workflow_dispatch`**, then save.
9. Open `/builds` to enable/disable builds, enable push-triggered builds, configure periodic frequency, trigger a manual build, and inspect build history.

No GitHub keys or installation tokens are sent to the browser. Installation tokens are request-local and never persisted.

## API and persistence

| Endpoint | Purpose |
| --- | --- |
| `GET /api/github/installations` | Active app installations filtered by server allowlist |
| `GET /api/github/repositories?installationId=…` | Live installation membership |
| `GET /api/github/options?installationId=…&repositoryId=…` | Branches, tags, active workflows |
| `GET /api/github/configurations?installationId=…` | Authorized persisted configuration and build settings |
| `POST /api/github/configurations` | Validate live membership/ref/workflow and save onboarding configuration |
| `GET /api/github/audit?installationId=…` | Most recent authorized audit records |
| `POST /api/github/webhook` | HMAC-verified durable GitHub event intake |
| `GET /api/builds/runs?installationId=…` | Authorized logical build-run history |
| `POST /api/builds/settings` | Enable builds, push triggers and periodic frequency |
| `POST /api/builds/manual` | Queue an idempotent manual build trigger |

Migration `002_github_onboarding.sql` adds onboarding/audit/webhook persistence. Migration `003_build_orchestration.sql` adds periodic build settings and the `build_runs` ledger. Every logical run records installation, repository, workflow, trigger, configured ref and exact commit SHA.

## Build lifecycle and scheduling

All triggers converge on the `build.trigger` worker job. Before dispatch, ORBIT revalidates live installation membership, the selected ref, and the selected workflow. A logical `build_runs` row is created before GitHub dispatch with status `queued`; its unique trigger key makes retry/event processing idempotent.

Periodic schedules are represented as a frequency in minutes. The worker claims due schedules transactionally using `FOR UPDATE SKIP LOCKED`, advances `next_scheduled_at`, and queues one logical trigger per due schedule slot. The UI offers 15/30/60-minute, 6-hour, daily and weekly frequencies.

Push webhooks create a trigger only when the repository is enabled, push-trigger builds are enabled, and the pushed Git ref matches the configured ref. Redelivered webhook delivery IDs are deduplicated before processing, so they cannot create duplicate logical runs.

GitHub `workflow_run` events correlate to the logical run by repository, workflow and commit SHA, then attach the GitHub run ID. ORBIT maps GitHub state into `queued`, `running`, `succeeded`, `failed`, or `canceled` and records start/completion timestamps.

The worker keeps bounded retries: failed jobs are retried after 30 seconds up to three attempts. Because a build trigger has a unique logical trigger key, retrying a job cannot dispatch a second logical run after the first row has been committed. Repository access revocation disables builds and clears future scheduling.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. ORBIT CI also starts PostgreSQL, applies every migration, verifies migration replay, and runs the production build.

Live acceptance requires a GitHub App configured with Actions write and a workflow containing `workflow_dispatch`: save an onboarded repository, enable builds, trigger **Build now**, observe the GitHub workflow, then confirm ORBIT history transitions through queued/running to a terminal state. Repeat a webhook delivery to verify no duplicate logical run is created.

## API references

- [GitHub installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [Webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
