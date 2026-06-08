#!/usr/bin/env bash
# Apply DB schema, start a background scheduler loop, then run Next.js.
set -e

# ── Pre-migrate backup ──────────────────────────────────────────────────────
# The schema is applied with `prisma db push --accept-data-loss` and there is no
# rollback, so a schema change could in principle drop data. Before applying it,
# if the live database already holds data AND its schema differs from the target,
# dump it to $BACKUP_DIR (a host-mounted volume) so there is always a restore
# point. Fail-closed: if the backup can't be written, we refuse to touch the
# schema. Disable with BACKUP_BEFORE_MIGRATE=false.
backup_before_migrate() {
  if [ "${BACKUP_BEFORE_MIGRATE:-true}" != "true" ]; then
    echo "[entrypoint] pre-migrate backup disabled (BACKUP_BEFORE_MIGRATE=false)"
    return 0
  fi
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "[entrypoint] WARNING: pg_dump not found — skipping pre-migrate backup"
    return 0
  fi

  # Connect via discrete libpq params, NOT the DATABASE_URL. libpq parses URLs
  # strictly, so a DB password containing %, @, etc. (all valid via env_file) makes
  # psql/pg_dump fail to parse the URL even though Prisma's looser parser accepts
  # it. The password comes straight from $DB_PASSWORD (any character, no parsing);
  # host/port come from the URL authority — the slice after the LAST '@' and before
  # the first '/', neither of which can contain the password's special characters.
  # Known limitation: an IPv6 host literal (e.g. [::1]:5432) would mis-parse in the
  # host:port split below — not supported here (use DB_USER/DB_NAME + a hostname).
  local authority="${DATABASE_URL##*@}"   # host:port/db?params  (password stripped)
  authority="${authority%%/*}"            # host:port
  local pghost="${authority%%:*}"
  local pgport="${authority##*:}"
  [ "$pgport" = "$authority" ] && pgport=5432   # no explicit port in the URL
  local pguser="${DB_USER:-ngrid}"
  local pgdb="${DB_NAME:-ngrid}"
  local -a pg_conn=(-h "$pghost" -p "$pgport" -U "$pguser" -d "$pgdb")

  # Probe for an app table to tell a fresh DB from a populated one. Distinguish the
  # probe's EXIT CODE from its output so a connect/auth/db-missing failure is NOT
  # mistaken for "fresh" (that would silently skip the only pre-migrate safety net):
  #   rc != 0           → AMBIGUOUS (could not connect) → fail closed.
  #   rc == 0, empty    → connected, table absent → genuinely fresh, skip backup.
  #   rc == 0, "1"      → table exists → fall through to the schema-diff/backup logic.
  # The discriminator is $rc, not stderr. `set -e` would abort on the failing probe
  # (a plain assignment whose command substitution fails does trip errexit), so turn
  # it off just around the probe and capture the real exit code into $rc.
  local has_account rc
  set +e
  has_account="$(PGPASSWORD="$DB_PASSWORD" psql "${pg_conn[@]}" -Atqc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Account' LIMIT 1" 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    echo "[entrypoint] ERROR: could not probe the database to decide on a pre-migrate backup."
    echo "[entrypoint] psql exited $rc connecting as user='$pguser' db='$pgdb' to $pghost:$pgport:"
    echo "[entrypoint]   $has_account"
    echo "[entrypoint] If DATABASE_URL points at an EXTERNAL Postgres, also set DB_USER/DB_NAME/DB_PASSWORD"
    echo "[entrypoint] to match it — the backup probe connects with those, not by parsing the URL."
    echo "[entrypoint] Otherwise the connection is misconfigured. Refusing to apply schema changes"
    echo "[entrypoint] without a verified backup. Set BACKUP_BEFORE_MIGRATE=false to override (NOT recommended)."
    exit 1
  fi
  if [ "$has_account" != "1" ]; then
    echo "[entrypoint] fresh database — no pre-migrate backup needed"
    return 0
  fi

  # Only back up when an upgrade will actually change the schema. `migrate diff`
  # exits 0 when the live DB already matches the target schema, non-zero otherwise.
  if npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code >/dev/null 2>&1; then
    echo "[entrypoint] database schema already in sync — no pre-migrate backup needed"
    return 0
  fi

  local dir="${BACKUP_DIR:-/data/backups}"
  mkdir -p "$dir"
  local out="$dir/ngrid-pre-migrate-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  echo "[entrypoint] schema change detected — backing up database to $out"
  # pipefail so a pg_dump failure fails the pipeline (gzip alone would still
  # succeed on empty input and mask it — that would defeat the safety net).
  if ! ( set -o pipefail; PGPASSWORD="$DB_PASSWORD" pg_dump "${pg_conn[@]}" | gzip > "$out" ); then
    rm -f "$out"
    echo "[entrypoint] ERROR: pre-migrate backup FAILED — refusing to apply schema changes."
    echo "[entrypoint] Fix the backup target, or set BACKUP_BEFORE_MIGRATE=false to override (NOT recommended)."
    exit 1
  fi

  # Retention: keep the newest BACKUP_RETENTION dumps (default 10).
  local keep="${BACKUP_RETENTION:-10}"
  ls -1t "$dir"/ngrid-pre-migrate-*.sql.gz 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm -f
  echo "[entrypoint] backup complete ($(du -h "$out" | cut -f1)); keeping newest $keep"
}

# Ops/test hook: run only the backup and exit (used by local/CI verification to
# exercise this exact code path without booting the app).
if [ "${1:-}" = "--pre-migrate-backup-only" ]; then
  backup_before_migrate
  exit $?
fi

echo "[entrypoint] syncing database schema..."
# Back up first (a no-op when the schema is unchanged or the DB is empty), then
# apply. db push is idempotent and needs no migration files, which keeps setup
# trivial for self-hosters. Additive changes apply cleanly.
backup_before_migrate
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
