#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "Starting PostgreSQL..."
docker compose up -d

echo "Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U orbit -d orbit >/dev/null 2>&1; do
  sleep 1
done

if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgres://orbit:orbit@localhost:5433/orbit}"

echo "Running migrations..."
npm run db:migrate

if ! pgrep -f "tsx src/worker/index.ts" >/dev/null; then
  echo "Starting ORBIT worker..."
  nohup npm run worker >/tmp/orbit-worker.log 2>&1 &
fi

if ! pgrep -f "next dev" >/dev/null; then
  echo "Starting ORBIT web server..."
  nohup npm run dev -- --hostname 0.0.0.0 --port 3000 >/tmp/orbit-next.log 2>&1 &
fi

echo ""
echo "ORBIT is starting."
echo "Web log:    /tmp/orbit-next.log"
echo "Worker log: /tmp/orbit-worker.log"
