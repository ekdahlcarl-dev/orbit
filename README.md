# ORBIT

ORBIT is the software quality intelligence platform defined in Linear project ORBIT.

## WP2 foundation

This is the standalone [ekdahlcarl-dev/orbit](https://github.com/ekdahlcarl-dev/orbit) repository. It establishes the executable boundaries for the ORBIT UI/API, PostgreSQL persistence, background jobs, object storage, configuration, structured logging and OpenTelemetry. Run all commands from this repository's root.

## Local development

```bash
cp -n .env.example .env.local
docker compose up -d --wait postgres
npm ci
set -a && source .env.local && set +a
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. Operational endpoints:

- `GET /api/health` — process + PostgreSQL health
- `GET /api/telemetry` — OpenTelemetry baseline configuration status

## Environments and secrets

Only `.env.example` is committed. `DATABASE_URL` and future credentials must be supplied through the runtime environment (local `.env.local`, CI secrets, or hosting-provider encrypted environment variables). No secret-valued variable uses the `NEXT_PUBLIC_` prefix.

The same application artifact is intended for development, test and production; `ORBIT_ENV` and environment-managed dependencies provide configuration differences.

## Module boundaries

- `src/app` — Next.js UI and HTTP API
- `src/lib` — server-side configuration, persistence, storage, logging and telemetry
- `src/worker` — durable background processing boundary
- `db/migrations` — ordered, transactional PostgreSQL schema migrations
- `scripts` — operational tooling

## Quality gates

```bash
npm run db:migrate
npm test
npm run typecheck
npm run lint
npm run build
```

GitHub Actions executes the same gates against PostgreSQL for every ORBIT pull request and change to `main`.

## Hosted development

Create a Codespace from **this repository** (`ekdahlcarl-dev/orbit`), not `lab`. The default dev container includes Docker and installs dependencies. Run the local-development commands above from the repository root; do not enter another `orbit/` subfolder.

In a second terminal, from the same repository root, start the worker:

```bash
set -a && source .env.local && set +a
npm run worker
```

Keep both terminals running. Port 3000 is private by default for browser testing. PostgreSQL port 5433 must not be exposed publicly. This is a temporary development environment, not a production deployment. Live GitHub webhook testing requires a reachable HTTPS endpoint and the secure configuration in [GITHUB_SETUP.md](GITHUB_SETUP.md).

## Repository migration

ORBIT was extracted from `ekdahlcarl-dev/lab/orbit`. Its ORB-2 and ORB-3 commits from LAB's `main` history retain their authors, dates and messages; commit IDs changed because the paths were moved to the repository root. Earlier PR discussions and unmerged branches remain in LAB.

- ORB-2: LAB `6b11c682` → ORBIT `41aaddb6`
- ORB-3: LAB `a0f72dad` → ORBIT `8d66879f`

CI and the ORBIT-specific Codespaces configuration originally lived outside the extracted folder and were adapted separately. Application code and database migrations are unchanged by the move.

## GitHub repository onboarding (ORB-3)

Open `/repositories` to configure authorized GitHub repositories. See [GITHUB_SETUP.md](GITHUB_SETUP.md) for App permissions, server secrets, operator access, webhook setup and verification. Build dispatch and scheduling remain ORB-4.
