# Architecture

## Stack

- **Next.js 14** (App Router, TypeScript) — UI **and** the JSON API in one app.
- **Postgres 16** + **Prisma** — storage.
- **Playwright** (Chromium) — the scraper, run **in-process** inside the app container.
- **Recharts** + **Tailwind** — charts and styling.
- Built on the official **`mcr.microsoft.com/playwright`** image so Chromium + its OS deps are
  present at runtime. `poppler-utils` (`pdftotext`) is added for PDF parsing.

Two containers: **`app`** (Next.js + scraper + scheduler) and **`ngrid_postgres`**.

## Data flow

```
Browser ─▶ Next.js (UI + /api/*) ─▶ Postgres
                │
                ├─ scraper (Playwright)  ─▶ myaccount.nationalgrid.com   (login, GraphQL, PDFs)
                │       └─ parsePdf (pdftotext) ─▶ per-fuel supply/delivery + current charges
                └─ scheduler (tickOnce) ─▶ predicts next bill, triggers scrapes
```

The scheduler is **not** an in-process cron daemon. `node-cron` broke the Next edge build and
the instrumentation hook never fired reliably, so a tiny `curl` loop in `docker-entrypoint.sh`
hits **`POST /api/cron/tick`** hourly (key-guarded via `CRON_KEY`), and `tickOnce()` decides
whether a scrape is actually due.

## Key modules (`app/src`)

| Path | Responsibility |
|---|---|
| `lib/ngrid/auth.ts` | Azure AD B2C login; session reuse via Playwright `storageState`; MFA detection. |
| `lib/ngrid/collect.ts` | One browser run: **intercept-and-widen** every dataset (bills, usage, costs, weather, account) + download new PDFs. |
| `lib/ngrid/parsePdf.ts` | **Pure** parser: turn `pdftotext -layout` output into per-fuel supply/delivery, usage, current charges, balance forward, amount due. |
| `lib/ngrid/persist.ts` | Idempotent upsert of a scrape result into Postgres. |
| `lib/ngrid/verify.ts` | Cross-validate stored/API numbers against a fresh parse of each bill PDF. |
| `lib/ngrid/run.ts` | Scrape orchestrator: run record, concurrency guard, schedule update. |
| `lib/scheduler.ts` | `tickOnce()` — run a SCHEDULED scrape if any account is due. |
| `lib/prediction.ts` | **Pure** next-bill prediction + check-cadence math. |
| `lib/series.ts` | **Pure** monthly aggregation + rate math (`deriveMonthlySeries`, `trailing12AllIn`). |
| `lib/queries.ts` | Thin DB read layer that feeds `series.ts`. |
| `lib/chartSpec.ts` | Declarative chart definitions (series, axes, colors). |
| `lib/prefs.tsx` | Client display prefs (localStorage + React context). |
| `app/api/*` | `overview`, `series`, `bills`, `bills/[date]/pdf`, `refresh(+[id])`, `runs`, `settings`, `verify`, `cron/tick`. |
| `components/*` | `Dashboard`, `ConfigurableChart`, `SettingsView`, `RefreshButton`, `Modal`. |
| `prisma/schema.prisma` | Data model. |

## Data model

- **Account** — accountNumber, region, companyCode, fuelTypes, address (region/company drive portability).
- **Bill** — `statementDate`, **`currentCharges`** (this period's energy cost, from the PDF — *use this for analysis*), `totalDueAmount` (statement Amount Due from the API — may include carryover), `pdfPath`. Unique `(accountId, statementDate)`.
- **Usage** — kWh / therms per `periodYearMonth`.
- **Cost** — per fuel, `kind` ∈ `SUPPLY` | `DELIVERY`, per month (parsed from PDFs).
- **Weather** — monthly avg temperature per region.
- **ScrapeRun** — audit trail / job status. **ScheduleState** — predicted next bill + next check.
- **AppSetting** — runtime key/value (e.g. `schedulerEnabled`).

Rates are **computed, not stored** (`series.ts`): supply rate = supply ÷ usage; all-in =
(supply+delivery) ÷ usage; the headline cards use a trailing-12-month all-in average.

## Design choices worth preserving

- **Pure functions for everything numeric** → unit-testable (see [Testing](./testing.md)).
- **PDF is authoritative** → [Data Accuracy](./data-accuracy.md).
- **Schema-as-source-of-truth** via `prisma db push` at startup (no migration files).
- **Region/company auto-detected** from the account response → no hardcoding, works across regions.
