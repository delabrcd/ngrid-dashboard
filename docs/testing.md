# Testing

Two layers, both required before merge.

## 1. Hand-calculated unit tests (vitest)

Pure functions are tested with values worked out by hand — `app/test/*.test.ts`:

- `parse.test.ts` — `parseBillDetail` against a synthetic bill fixture (supply/delivery/usage,
  current charges vs amount due, the carried-balance case).
- `series.test.ts` — `deriveMonthlySeries` + `trailing12AllIn` (e.g. supply \$40 ÷ 500 kWh =
  \$0.08; all-in \$100 ÷ 500 = \$0.20), asserted to many decimals.
- `prediction.test.ts` — median interval, next-bill date, check cadence.

Run them (no DB, no browser, no host Node needed):

```bash
docker build --target test -t ngrid-dashboard-test ./app
docker run --rm ngrid-dashboard-test
```

The `test` stage in the `Dockerfile` copies the source + deps and runs `vitest run`.

**When you add pure logic, add a test for it.** Prefer a tiny hand-computed fixture over a
snapshot — the point is to prove the arithmetic, not to freeze whatever it currently outputs.

## 2. Real-data cross-validation

`GET /api/verify` (or **Settings → Verify all bills**) re-parses every stored bill PDF and
cross-checks the API/stored numbers against it — see [Data Accuracy](./data-accuracy.md) for the full list. This
is what catches "the API gave us a plausible-but-wrong value."

```bash
curl -s localhost:3000/api/verify | jq '{ok, total, failed}'
curl -s 'localhost:3000/api/verify?fails=1' | jq   # only the failing bills, with detail
```

## The bar for a PR

- `docker run --rm ngrid-dashboard-test` is green.
- For any change touching numbers: `/api/verify` is green on a real account (paste the summary).
- New pure logic ships with a hand-calculated test.

> CI currently builds/publishes the image; it does not yet run the unit tests. Running the test
> stage locally is required. Adding the test stage to the CI workflow is a welcome contribution.
