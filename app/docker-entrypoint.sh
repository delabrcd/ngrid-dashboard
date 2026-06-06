#!/usr/bin/env bash
# Apply DB schema, start a background scheduler loop, then run Next.js.
set -e

echo "[entrypoint] syncing database schema..."
# Schema-as-source-of-truth: db push is idempotent and needs no migration files,
# which keeps setup trivial for self-hosters. Additive changes apply cleanly.
npx prisma db push --skip-generate --accept-data-loss

# Shared key so the internal cron endpoint can't be triggered externally.
export CRON_KEY="${CRON_KEY:-$(head -c24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c24)}"

# Background scheduler: first tick shortly after boot (initial population), then
# hourly. The tick endpoint itself decides whether a scrape is actually due.
(
  sleep 25
  while true; do
    curl -fsS -m 290 -X POST -H "x-cron-key: ${CRON_KEY}" http://127.0.0.1:3000/api/cron/tick \
      && echo "" || echo "[entrypoint] cron tick failed (will retry)"
    sleep 3600
  done
) &

echo "[entrypoint] starting Next.js on :3000"
exec npx next start -p 3000 -H 0.0.0.0
