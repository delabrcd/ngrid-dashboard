# Data Accuracy — the most important page

**The numbers must be correct, not just plausible.** This is the project's defining
requirement. An API can hand you a number that looks reasonable and is *wrong for your
purpose*. We caught two real cases:

1. **The API's "supply cost" isn't the bill's supply charge.** `energyUsageCosts` looked like
   supply but didn't match the bill (e.g. 2026-04 reported \$130.57 vs the bill's \$58.37).
2. **`totalDueAmount` is the statement *Amount Due*, not the period's energy cost.** On a bill
   with a carried-over balance it's `current charges + balance forward` (e.g. \$207.46 =
   \$205.37 + \$2.09). Summing it for "lifetime spend" double-counts carryovers.

So: **the bill PDF is the source of truth.** We parse each PDF for the real per-fuel
supply/delivery and the **Total Current Charges**, and use *those* for all cost/rate/spend
analysis. The API is used for what it's reliable at (the bill list dates, usage quantities).

## Definitions (use these terms precisely)

- **Current charges** — this billing period's energy cost (PDF "Total Current Charges"). **This
  is what cost/rate/lifetime analysis uses** (`Bill.currentCharges`).
- **Amount due** — the statement total = current charges + any carried-over balance/late fees
  (`Bill.totalDueAmount`, from the API). Don't use it for cost analysis.
- **Supply** vs **delivery** — the two halves of each fuel's charge, parsed per-fuel from the PDF.
- **Supply rate** = supply ÷ usage. **All-in rate** = (supply + delivery) ÷ usage. The headline
  cards show a **trailing-12-month all-in average** (a single low-usage month makes fixed
  charges blow up the per-unit rate).

## Hard requirements for any change that touches a number

1. **Cross-validation must stay green.** `GET /api/verify` (or Settings → *Verify all bills*)
   re-parses every bill PDF and asserts the stored/API numbers match it. All checks must pass.
2. **Add/keep hand-calculated unit tests.** New parsing or math needs a test with values you
   worked out by hand (see [Testing](./testing.md)). No "looks right" — prove it.
3. **Keep the logic pure.** Parsing → `parsePdf.ts`; aggregation/rates → `series.ts`; prediction
   → `prediction.ts`. Pure functions are what the unit tests exercise.

## What `/api/verify` checks (per bill)

- `bill total: stored == PDF` current charges.
- `electric/gas usage: API == PDF`.
- `electric/gas supply + delivery == service total` (PDF internal consistency).
- `delivery/supply columns reconcile` across fuels.
- `fuels + other == current charges`.
- `API amount due == current charges + balance forward` (explains carryovers).
- `DB <fuel> <kind> == PDF` (no storage drift).

A green run across all bills is the bar. If you change how a number is sourced or computed,
run verify against a **real** account and paste the `{ok, total, failed}` summary in your PR.
