# How the Scraper Works

## Login (Azure AD B2C)

`myaccount.nationalgrid.com` uses Azure AD B2C (OAuth2 + PKCE). `auth.ts`:
- Fills the custom B2C form (email `#signInName`, password `#password`, submit `#interceptButton`).
- **Reuses the session** via Playwright `storageState` so it rarely re-logs-in — this is the
  main defense against rate-limiting/lockout. Only re-authenticates when the saved session is
  expired.
- **Detects MFA/OTP** and fails with a clear message (unattended MFA isn't supported).

## The golden technique: intercept-and-widen

The portal's data APIs are GraphQL at `/api/<svc>-cu-uwp-gql`. They require an
`authorization` bearer **and** an `ocp-apim-subscription-key` header that the SPA adds
client-side — so a hand-built `fetch` gets `401`. **Do not rebuild requests.**

Instead, let the app issue its own request and use `page.route(...)` to **rewrite only the
query variables** (widening date/paging filters), leaving the auth headers intact:

```ts
await page.route('**/api/**-gql', async (route) => {
  const j = JSON.parse(route.request().postData() || '{}');
  if ('dateForNumberOfDaysAgo' in (j.variables ?? {})) j.variables.dateForNumberOfDaysAgo = '2000-01-01';
  if (typeof j.variables?.from === 'number')  j.variables.from = 200001;   // YYYYMM
  if (typeof j.variables?.first === 'number') j.variables.first = 1000;
  await route.continue({ postData: JSON.stringify(j) });
});
```

## Data sources

| Dataset | Endpoint / op | Notes |
|---|---|---|
| Bills | `bill-cu-uwp-gql` / `BillHistory` | widen `dateForNumberOfDaysAgo` → full history |
| Usage (kWh/therms) | `energyusage-cu-uwp-gql` / `EnergyUsage` → `energyUsages` | widen numeric `from`/`first` |
| Supply cost (API) | same → `energyUsageCosts` | ~24 mo only; **not used** for the breakdown (see below) |
| Per-fuel bill amount (API) | same / `BillComparison` | ~24 mo only |
| Weather | `weather-cu-uwp-gql` | **don't widen** its `from`/`last` — that returns empty |
| Account | `billingaccount-cu-uwp-gql` / `OpowerAccount` | region, companyCode, fuels, address |
| Bill PDFs | `GET /api/bill-cu-uwp-sys/v1/bills/view-pdf/{statementDate}` | **requires an `account-number` header** |

The **cost breakdown comes from the PDFs**, not the API: the `bills` type (`BillResponse`)
exposes no charge fields, introspection is disabled (`HC0046`), and `energyUsageCosts` only
covers ~24 months *and mislabels the split*. See [Data Accuracy](./data-accuracy.md).

## Gotchas (learned the hard way)

- **Don't widen the weather query** (`from`/`last`) — it returns an empty set. Only the bills
  and energy-usage queries are safe to widen.
- **Re-visit the dashboard with handlers attached** — weather and per-fuel bill amounts fire on
  the `/dashboard` page, so `collect.ts` navigates dashboard → bill-history → energy-usage.
- **Account quirks:** `fuelTypes` come as `[{type}]` objects; `serviceAddress` is a nested
  object (`serviceAddressCompressed`). Normalize them.
- **PDF view endpoint** needs `account-number` in addition to the bearer + subscription key.
- **Portability:** `region`/`companyCode` come from the account, so other NG regions work
  unchanged. If you add a query, derive these from the account, never hardcode.

When the portal changes, set `SCRAPE_DEBUG=1` and watch `[collect] gql keys:` to see what
actually came back.
