// Pure bill-recap arithmetic (issue #111). No DB, no React, no network.
//
// Given the full MonthRow series and the ym of the just-arrived bill, builds a
// BillRecap comparing the new bill against:
//   • the immediately prior statement (vsLast)
//   • the same calendar month one year earlier (vsYearAgo — ym − 100)
//
// ALL cost comparisons use the period energy cost fields (billTotal / elecBill /
// gasBill — currentCharges-sourced), NEVER totalDueAmount. Per AGENTS.md rule 1.
//
// Period-length differences: bills run ~28–35 days; a longer cycle isn't
// genuinely a spike. We carry day counts for both periods on every comparison so
// the UI can note the difference, and derive a per-day normalized cost delta
// alongside the raw one.
//
// Safe degradation: missing baseline → that comparison is null (UI hides it).
// Missing fuel in one period → that fuel's row is null (UI shows "—").
// Brand-new account with one bill → both comparisons null. NEVER NaN or $0.

import type { MonthRow } from './chartSpec';
import { compareYoY, trailing12AllIn } from './series';

// ── Types ─────────────────────────────────────────────────────────────────────

// One fuel's comparison in a baseline.
export interface FuelDelta {
  // Period energy cost for this fuel (elecBill / gasBill) in both periods.
  costA: number; // arriving bill's fuel cost ($)
  costB: number; // baseline bill's fuel cost ($)
  costDelta: number; // costA − costB ($); positive = more expensive
  costPct: number | null; // costDelta / costB; null when costB = 0

  // Per-day normalized cost delta (accounts for different billing cycle lengths).
  // costPerDayA / costPerDayB are null when days is unavailable for either period.
  costPerDayA: number | null;
  costPerDayB: number | null;
  costPerDayDelta: number | null; // costPerDayA − costPerDayB

  // Usage in natural units (kWh for electric, therms for gas).
  usageA: number | null;
  usageB: number | null;
  usageDelta: number | null; // usageA − usageB; null when either is absent

  // Effective all-in $/unit for this period (cost / usage).
  rateA: number | null;
  rateB: number | null;
  rateDelta: number | null; // rateA − rateB

  // Weather decomposition of the usage change (issue #111 extension).
  // Sourced from compareYoY (series.ts): rawUsageDelta = weatherExplainedDelta + activityDelta exactly.
  // All three are null when either period lacks usable usage + degree-day data.
  weatherExplainedDelta: number | null; // intensityB × (ddA − ddB): how much DD change alone explains
  activityDelta: number | null; // (intensityA − intensityB) × ddA: the behaviour-driven change
  normalizedUsagePct: number | null; // (intensityA − intensityB) / intensityB: the "did I actually use less?" signal
}

// All-in (both fuels combined) comparison in a baseline.
export interface AllInDelta {
  costA: number; // billTotal of arriving bill
  costB: number; // billTotal of baseline bill
  costDelta: number; // costA − costB
  costPct: number | null; // costDelta / costB; null when costB = 0

  // Per-day normalized (same rationale as FuelDelta).
  costPerDayA: number | null;
  costPerDayB: number | null;
  costPerDayDelta: number | null;
}

// One complete comparison (vsLast or vsYearAgo).
export interface RecapComparison {
  baselineYm: number; // ym of the baseline row
  baselineLabel: string; // human label from the baseline row
  daysA: number | null; // bill period length of the arriving bill
  daysB: number | null; // bill period length of the baseline bill
  elec: FuelDelta | null; // null when either bill has no elecBill
  gas: FuelDelta | null; // null when either bill has no gasBill
  allIn: AllInDelta | null; // null when either bill has no billTotal
}

// The full recap for one just-arrived bill.
export interface BillRecap {
  statementYm: number;
  daysA: number | null; // period length of the arriving bill
  vsLast: RecapComparison | null; // null when no prior row exists
  vsYearAgo: RecapComparison | null; // null when the ym−100 row is absent
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const div = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b > 0 ? a / b : null;

const pct = (delta: number, base: number): number | null =>
  base !== 0 ? delta / base : null;

// Weather fields pre-computed by compareYoY; passed into buildFuelDelta so the
// decomposition arithmetic lives exclusively in series.ts (not duplicated here).
interface WeatherDecomp {
  weatherExplainedDelta: number;
  activityDelta: number;
  normalizedUsagePct: number | null;
}

// Build a FuelDelta for one fuel across two rows.
// costKey: 'elecBill' | 'gasBill'
// useKey: 'kwh' | 'therms'
// wx: pre-computed weather decomposition from compareYoY, or null when unavailable.
function buildFuelDelta(
  rowA: MonthRow,
  rowB: MonthRow,
  costKey: 'elecBill' | 'gasBill',
  useKey: 'kwh' | 'therms',
  wx: WeatherDecomp | null
): FuelDelta | null {
  const costA = rowA[costKey] ?? null;
  const costB = rowB[costKey] ?? null;
  // Require BOTH bills to have a cost for this fuel; otherwise the UI should show "—".
  if (costA == null || costB == null) return null;

  const delta = costA - costB;

  const costPerDayA = div(costA, rowA.days ?? null);
  const costPerDayB = div(costB, rowB.days ?? null);
  const costPerDayDelta =
    costPerDayA != null && costPerDayB != null ? costPerDayA - costPerDayB : null;

  const usageA = (rowA[useKey] as number | null) ?? null;
  const usageB = (rowB[useKey] as number | null) ?? null;
  const usageDelta = usageA != null && usageB != null ? usageA - usageB : null;

  const rateA = div(costA, usageA);
  const rateB = div(costB, usageB);
  const rateDelta = rateA != null && rateB != null ? rateA - rateB : null;

  return {
    costA,
    costB,
    costDelta: delta,
    costPct: pct(delta, costB),
    costPerDayA,
    costPerDayB,
    costPerDayDelta,
    usageA,
    usageB,
    usageDelta,
    rateA,
    rateB,
    rateDelta,
    weatherExplainedDelta: wx?.weatherExplainedDelta ?? null,
    activityDelta: wx?.activityDelta ?? null,
    normalizedUsagePct: wx?.normalizedUsagePct ?? null,
  };
}

// Build the all-in delta from billTotal on two rows.
function buildAllInDelta(rowA: MonthRow, rowB: MonthRow): AllInDelta | null {
  const costA = rowA.billTotal ?? null;
  const costB = rowB.billTotal ?? null;
  if (costA == null || costB == null) return null;

  const delta = costA - costB;

  const costPerDayA = div(costA, rowA.days ?? null);
  const costPerDayB = div(costB, rowB.days ?? null);
  const costPerDayDelta =
    costPerDayA != null && costPerDayB != null ? costPerDayA - costPerDayB : null;

  return {
    costA,
    costB,
    costDelta: delta,
    costPct: pct(delta, costB),
    costPerDayA,
    costPerDayB,
    costPerDayDelta,
  };
}

// Build a RecapComparison for rowA (arriving bill) vs rowB (baseline).
// `allRows` is the full series — used by trailing12AllIn to compute the current
// all-in rate for the weather-normalized decomposition (same basis as the YoY card).
//
// `includeWeather` gates the weather-normalized usage split. It's meaningful ONLY
// when the two periods share comparable degree-days — i.e. the same calendar month
// a year apart (vsYearAgo). Across CONSECUTIVE months of different seasons (vsLast),
// degree-days swing wildly while electric is largely non-weather baseload, so the
// intensity ratio explodes into misleading artifacts (e.g. elec −75% Oct→Nov). So
// callers pass includeWeather=true for vsYearAgo only; vsLast shows raw usage Δ.
function buildComparison(
  rowA: MonthRow,
  rowB: MonthRow,
  allRows: MonthRow[],
  includeWeather: boolean
): RecapComparison {
  // Run compareYoY on the two single-row windows to get the weather decomposition.
  // Rate inputs are trailing-12 all-in $/unit — same basis the YoY card uses.
  const yoy = includeWeather
    ? compareYoY([rowA], [rowB], {
        elec: trailing12AllIn(allRows, 'elec'),
        gas: trailing12AllIn(allRows, 'gas'),
      })
    : { elec: null, gas: null };

  const wxElec: WeatherDecomp | null = yoy.elec
    ? { weatherExplainedDelta: yoy.elec.weatherExplainedDelta, activityDelta: yoy.elec.intensityDelta, normalizedUsagePct: yoy.elec.normalizedPct }
    : null;
  const wxGas: WeatherDecomp | null = yoy.gas
    ? { weatherExplainedDelta: yoy.gas.weatherExplainedDelta, activityDelta: yoy.gas.intensityDelta, normalizedUsagePct: yoy.gas.normalizedPct }
    : null;

  return {
    baselineYm: rowB.ym,
    baselineLabel: rowB.label,
    daysA: rowA.days ?? null,
    daysB: rowB.days ?? null,
    elec: buildFuelDelta(rowA, rowB, 'elecBill', 'kwh', wxElec),
    gas: buildFuelDelta(rowA, rowB, 'gasBill', 'therms', wxGas),
    allIn: buildAllInDelta(rowA, rowB),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

// Determine whether a row has sufficient data to be usable as a baseline.
// Requires at least one cost figure (so the comparison isn't trivially null).
function hasUsableData(r: MonthRow): boolean {
  return r.billTotal != null || r.elecBill != null || r.gasBill != null;
}

/**
 * Build a BillRecap for the bill identified by `statementYm`.
 *
 * - Picks the row with ym === statementYm as the arriving bill (rowA).
 * - vsLast: the row with the highest ym < statementYm that has usable cost data.
 * - vsYearAgo: the row with ym === statementYm − 100.
 * - Returns null when no row matches statementYm (the bill isn't in the series).
 */
export function buildBillRecap(rows: MonthRow[], statementYm: number): BillRecap | null {
  const rowA = rows.find((r) => r.ym === statementYm);
  if (!rowA) return null;

  // Prior row: highest ym strictly less than statementYm with usable data.
  const candidates = rows.filter((r) => r.ym < statementYm && hasUsableData(r));
  const prior = candidates.length > 0 ? candidates[candidates.length - 1] : null;

  // Year-ago row: exact ym−100 match.
  const yearAgoYm = statementYm - 100;
  const yearAgo = rows.find((r) => r.ym === yearAgoYm) ?? null;

  return {
    statementYm,
    daysA: rowA.days ?? null,
    // vsLast: raw usage only (consecutive-month weather normalization is unreliable).
    vsLast: prior ? buildComparison(rowA, prior, rows, false) : null,
    // vsYearAgo: same calendar month → degree-days comparable → weather split is honest.
    vsYearAgo: yearAgo && hasUsableData(yearAgo) ? buildComparison(rowA, yearAgo, rows, true) : null,
  };
}
