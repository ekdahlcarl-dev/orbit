# ORBIT

ORBIT is the software quality intelligence platform defined in Linear project ORBIT.

## WP2 foundation

This folder is intentionally self-contained inside the development repository. It establishes the executable boundaries for the ORBIT UI/API, PostgreSQL persistence, background jobs, object storage, configuration, structured logging and OpenTelemetry.

## Local development

```bash
cp .env.example .env.local
docker compose up -d postgres
npm install
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

The repository is Codespaces/devcontainer-enabled. From a hosted Codespace, enter `orbit/` and use the same commands above. The app listens on port 3000, which Codespaces can forward for browser testing.
