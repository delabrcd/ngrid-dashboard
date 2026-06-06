# Development Setup

## Prerequisites

Just **Docker** + the Docker Compose plugin. You do **not** need Node, Postgres, or Playwright
on your host — everything builds and runs in containers (the scraper needs Chromium + system
libs that the Playwright base image already provides).

## Clone, configure, run (built from source)

```bash
git clone https://github.com/delabrcd/ngrid-dashboard && cd ngrid-dashboard
cp .env.example .env          # set NGRID_USER / NGRID_PASS and a DB_PASSWORD
# build locally instead of pulling the published image:
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Open http://localhost:3000 and click **Check for new bills** (first run logs in, pulls your
full history + PDFs — a couple of minutes).

> The default `docker-compose.yml` is **pull-only** (it grabs the GHCR image). Use the
> `docker-compose.build.yml` override above to build your working tree.

## Triggering a scrape

- **UI:** the "Check for new bills" button.
- **API:** `curl -X POST http://localhost:3000/api/refresh` → returns a `runId`; poll
  `GET /api/refresh/<id>`.
- **CLI (inside the container):** `npm run scrape` runs one collect+persist.

## Inspecting data

```bash
# DB shell
docker compose exec ngrid_postgres psql -U ngrid -d ngrid

# API
curl -s localhost:3000/api/overview | jq
curl -s localhost:3000/api/series   | jq '.rows[-3:]'
curl -s localhost:3000/api/verify   | jq '{ok,total,failed}'   # cross-validation
```

## Storage (where data lives)

- **Postgres** → Docker named volume `pgdata`.
- **Login session** (sensitive auth tokens) → Docker named volume `session`, file `0600`.
- **Bill PDFs** → host directory, `./data/pdfs` by default (set `PDF_DIR` in `.env` to relocate).

Wipe everything: `docker compose down -v` (removes named volumes) and delete your PDF dir.

## Environment variables

| Var | Purpose |
|---|---|
| `NGRID_USER` / `NGRID_PASS` | Your National Grid login (read at runtime; never commit). |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DATABASE_URL` | Postgres + Prisma. |
| `PDF_DIR` | Host path for bill PDFs (default `./data/pdfs`). |
| `APP_PORT` | Host port for the UI. |
| `TZ` | Timezone. |
| `SCHEDULER_ENABLED` | `false` disables auto-checks (also toggleable at runtime in Settings). |
| `SCRAPE_DEBUG` | `1` logs the GraphQL data keys each scrape captured — useful when the portal changes. |

## Debugging a scrape

- Set `SCRAPE_DEBUG=1` and watch `docker compose logs -f app` for `[collect] gql keys: ...`.
- The scraper writes login screenshots/HTML on failure (see `auth.ts`).
- If a dataset is empty, confirm which page it loads on and that `collect.ts` visits it — some
  queries (weather, per-fuel bill amounts) fire on the **dashboard** page.
