// Pure logic for smart-meter AMI interval usage ingest (issue #76).
//
// The portal exposes interval reads at a REST endpoint (NOT GraphQL):
//   GET /api/amiadapter-cu-uwp-sys/v1/interval/reads/{premise}/{servicePoint}
//       ?startDateTime=YYYY-MM-DD HH:MM:SS
//   → [ { startTime, endTime, value }, … ]   one object per interval
//
// Everything in this file is PURE (no DB / Playwright / fs) so the number and
// shape logic is unit-tested in isolation. The impure ingest (collect.ts) and
// upsert (persist.ts) call into these helpers. Per AGENTS.md rule #1, interval
// usage NEVER feeds billed-cost numbers — this is observational AMI data only.

// One parsed interval read, ready for the IntervalUsage upsert.
export type IntervalReadRow = {
  fuelType: string; // ELECTRIC | GAS (normalized)
  intervalStart: Date; // UTC instant the interval begins
  intervalSeconds: number; // 900 | 3600 | 86400 (endTime − startTime)
  quantity: number; // usage for the interval, in `unit`
  unit: string; // kWh | therms
  source: string; // 'portal'
};

// One raw read object as returned by the amiadapter endpoint.
export type RawIntervalRead = { startTime: string; endTime: string; value: number };

// Normalize the portal's fuel labels ("Gas", "ELECTRIC", "Electricity", …) to
// the ELECTRIC | GAS the rest of the app uses. Unknown labels pass through
// upper-cased so nothing is silently dropped.
export function normalizeFuel(raw: string): 'ELECTRIC' | 'GAS' | string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s.startsWith('ELEC')) return 'ELECTRIC';
  if (s.startsWith('GAS')) return 'GAS';
  return s;
}

// The display/storage unit for a fuel. Electric is kWh, gas is therms; anything
// else gets an empty unit (caller still stores the row).
export function unitForFuel(fuel: string): 'kWh' | 'therms' | '' {
  const f = normalizeFuel(fuel);
  if (f === 'ELECTRIC') return 'kWh';
  if (f === 'GAS') return 'therms';
  return '';
}

// Parse a batch of raw interval reads for ONE fuel into IntervalReadRows.
// - intervalStart = new Date(startTime): JS parses the ±HH:MM offset, yielding
//   the correct UTC instant (so DST fall-back's repeated 01:00 locals at -04:00
//   then -05:00 become two DISTINCT instants — both kept, no unique collision).
// - intervalSeconds = round((endTime − startTime) / 1000): granularity is
//   measured, never assumed (electric 15-min, gas may differ).
// Drops rows with a non-finite value, an unparseable/zero-length interval, or a
// bad start date. Sorts by intervalStart, then dedups by
// `start.getTime()+':'+seconds` keeping the LAST occurrence.
export function parseIntervalReads(
  raw: Array<{ startTime: string; endTime: string; value: number }>,
  fuelType: string,
  unit: string,
  source = 'portal'
): IntervalReadRow[] {
  const fuel = normalizeFuel(fuelType);
  const rows: IntervalReadRow[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const value = Number(r?.value);
    if (!Number.isFinite(value)) continue;
    const startMs = Date.parse(r?.startTime);
    const endMs = Date.parse(r?.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const intervalSeconds = Math.round((endMs - startMs) / 1000);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) continue;
    rows.push({
      fuelType: fuel,
      intervalStart: new Date(startMs),
      intervalSeconds,
      quantity: value,
      unit,
      source,
    });
  }
  rows.sort((a, b) => a.intervalStart.getTime() - b.intervalStart.getTime());
  // Dedup on the storage key (UTC instant + length); later rows win.
  const byKey = new Map<string, IntervalReadRow>();
  for (const row of rows) {
    byKey.set(`${row.intervalStart.getTime()}:${row.intervalSeconds}`, row);
  }
  return [...byKey.values()].sort((a, b) => a.intervalStart.getTime() - b.intervalStart.getTime());
}

// Pull the AMI-capable meter nodes out of the captured `billingAccount`.
// Shape: billingAccount.meter.nodes[] where each node has fuelType,
// servicePointNumber, optional meterNumber, and the per-meter AMI capability
// flag hasAmiSmartMeter. We GATE on hasAmiSmartMeter === true (issue #76) and
// require a servicePointNumber to build the URL. Tolerates any missing/garbage
// shape by returning [].
export function extractAmiMeters(
  billingAccount: unknown
): Array<{ fuelType: string; servicePointNumber: string; meterNumber?: string }> {
  const ba = billingAccount as { meter?: { nodes?: unknown } } | null | undefined;
  const nodes = ba?.meter?.nodes;
  if (!Array.isArray(nodes)) return [];
  const out: Array<{ fuelType: string; servicePointNumber: string; meterNumber?: string }> = [];
  for (const n of nodes) {
    const node = n as {
      fuelType?: unknown;
      servicePointNumber?: unknown;
      meterNumber?: unknown;
      hasAmiSmartMeter?: unknown;
    } | null;
    if (!node || node.hasAmiSmartMeter !== true) continue;
    if (node.servicePointNumber == null || node.servicePointNumber === '') continue;
    out.push({
      fuelType: normalizeFuel(String(node.fuelType ?? '')),
      servicePointNumber: String(node.servicePointNumber),
      meterNumber: node.meterNumber != null ? String(node.meterNumber) : undefined,
    });
  }
  return out;
}

// Build the amiadapter interval-reads URL. The startDateTime is the portal's
// `YYYY-MM-DD HH:MM:SS` local-ish string; its space is encoded as %20.
export function amiIntervalUrl(
  base: string,
  premiseNumber: string,
  servicePointNumber: string,
  startDateTime: string
): string {
  const path = `/api/amiadapter-cu-uwp-sys/v1/interval/reads/${encodeURIComponent(
    premiseNumber
  )}/${encodeURIComponent(servicePointNumber)}`;
  const q = `startDateTime=${startDateTime.replace(/ /g, '%20')}`;
  return `${base.replace(/\/$/, '')}${path}?${q}`;
}

// Format a Date as the portal's `YYYY-MM-DD HH:MM:SS` (UTC fields). The endpoint
// is lenient about the exact wall-clock; we only need a floor far enough back to
// cover the requested window, and the upsert makes any overlap idempotent.
function fmtPortal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Decide the `startDateTime` to request for a meter:
//   1. explicit backfillFromIso (operator override) → use that date,
//   2. else a known lastStored instant → that minus a 1-day overlap (idempotent
//      catch-up; the upsert dedups the overlap),
//   3. else a default tail of `windowDays` before `now`.
// Returns the portal's `YYYY-MM-DD HH:MM:SS` string. PURE.
export function backfillStartFor(
  now: Date,
  lastStored: Date | null,
  backfillFromIso: string | undefined,
  windowDays: number
): string {
  if (backfillFromIso) {
    const t = Date.parse(backfillFromIso);
    if (Number.isFinite(t)) return fmtPortal(new Date(t));
  }
  if (lastStored) {
    return fmtPortal(new Date(lastStored.getTime() - DAY_MS));
  }
  return fmtPortal(new Date(now.getTime() - windowDays * DAY_MS));
}
