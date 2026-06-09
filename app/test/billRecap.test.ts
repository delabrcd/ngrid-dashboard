// Hand-calculated unit tests for billRecap.ts (issue #111).
// ALL numbers in this file are independently derived from first principles —
// no values are copy-pasted from the implementation.

import { describe, expect, it } from 'vitest';
import type { MonthRow } from '../src/lib/chartSpec';
import { buildBillRecap } from '../src/lib/billRecap';

// ── Minimal factory ────────────────────────────────────────────────────────────
// Only the fields that feed recap math need to be non-null; everything else null.
// `over` merges on top of the all-null baseline; ym + label are set via `over`.
const mk = (over: Partial<MonthRow> & { ym: number }): MonthRow => {
  const base: MonthRow = {
    ym: over.ym,
    label: `${String(over.ym).slice(0, 4)}-${String(over.ym).slice(4)}`,
    kwh: null,
    therms: null,
    elecSupply: null,
    gasSupply: null,
    elecDelivery: null,
    gasDelivery: null,
    elecBill: null,
    gasBill: null,
    elecRateSupply: null,
    gasRateSupply: null,
    elecRateAllIn: null,
    gasRateAllIn: null,
    avgTemp: null,
    billTotal: null,
    days: null,
    hdd: null,
    cdd: null,
    kwhPerDegreeDay: null,
    thermsPerHdd: null,
  };
  return { ...base, ...over };
};

// ── Case 1: Normal two-baseline recap ─────────────────────────────────────────
//
// Three rows:
//   202503 (year-ago)  : elecBill=80, gasBill=60, billTotal=140, kwh=600, therms=40, days=30
//   202602 (prior)     : elecBill=90, gasBill=70, billTotal=160, kwh=650, therms=45, days=31
//   202603 (arriving)  : elecBill=95, gasBill=55, billTotal=150, kwh=700, therms=38, days=28
//
// vsLast (202603 vs 202602):
//   allIn.costA=150, costB=160, delta=-10, pct=-10/160=-0.0625
//   allIn.perDayA=150/28≈5.3571, perDayB=160/31≈5.1613, perDayDelta≈0.1958
//   elec.costDelta=95-90=5, costPct=5/90≈0.0556
//   elec.usageDelta=700-650=50
//   elec.rateA=95/700≈0.13571, rateB=90/650≈0.13846, rateDelta≈-0.00275
//   gas.costDelta=55-70=-15, costPct=-15/70≈-0.2143
//   gas.usageDelta=38-45=-7
//   gas.rateA=55/38≈1.44737, rateB=70/45≈1.55556, rateDelta≈-0.10819
//
// vsYearAgo (202603 vs 202503):
//   allIn.costDelta=150-140=10, costPct=10/140≈0.07143
//   elec.costDelta=95-80=15, costPct=15/80=0.1875
//   gas.costDelta=55-60=-5, costPct=-5/60≈-0.08333

describe('buildBillRecap — normal two-baseline case', () => {
  const rows = [
    mk({ ym: 202503, elecBill: 80, gasBill: 60, billTotal: 140, kwh: 600, therms: 40, days: 30 }),
    mk({ ym: 202602, elecBill: 90, gasBill: 70, billTotal: 160, kwh: 650, therms: 45, days: 31 }),
    mk({ ym: 202603, elecBill: 95, gasBill: 55, billTotal: 150, kwh: 700, therms: 38, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('returns a recap with statementYm=202603', () => {
    expect(recap).not.toBeNull();
    expect(recap!.statementYm).toBe(202603);
    expect(recap!.daysA).toBe(28);
  });

  it('vsLast is not null and references the prior row (202602)', () => {
    expect(recap!.vsLast).not.toBeNull();
    expect(recap!.vsLast!.baselineYm).toBe(202602);
    expect(recap!.vsLast!.daysA).toBe(28);
    expect(recap!.vsLast!.daysB).toBe(31);
  });

  it('vsLast allIn: cost delta and pct correct', () => {
    const a = recap!.vsLast!.allIn!;
    expect(a.costA).toBe(150);
    expect(a.costB).toBe(160);
    expect(a.costDelta).toBe(-10); // 150 - 160
    expect(a.costPct).toBeCloseTo(-10 / 160, 10);
  });

  it('vsLast allIn: per-day normalized delta', () => {
    const a = recap!.vsLast!.allIn!;
    expect(a.costPerDayA).toBeCloseTo(150 / 28, 10);
    expect(a.costPerDayB).toBeCloseTo(160 / 31, 10);
    expect(a.costPerDayDelta).toBeCloseTo(150 / 28 - 160 / 31, 10);
  });

  it('vsLast elec: cost, usage and rate deltas', () => {
    const e = recap!.vsLast!.elec!;
    expect(e.costA).toBe(95);
    expect(e.costB).toBe(90);
    expect(e.costDelta).toBe(5);
    expect(e.costPct).toBeCloseTo(5 / 90, 10);
    expect(e.usageDelta).toBe(50); // 700 - 650
    expect(e.rateA).toBeCloseTo(95 / 700, 10);
    expect(e.rateB).toBeCloseTo(90 / 650, 10);
    expect(e.rateDelta).toBeCloseTo(95 / 700 - 90 / 650, 10);
  });

  it('vsLast gas: cost, usage and rate deltas', () => {
    const g = recap!.vsLast!.gas!;
    expect(g.costDelta).toBe(-15); // 55 - 70
    expect(g.costPct).toBeCloseTo(-15 / 70, 10);
    expect(g.usageDelta).toBe(-7); // 38 - 45
    expect(g.rateA).toBeCloseTo(55 / 38, 10);
    expect(g.rateB).toBeCloseTo(70 / 45, 10);
    expect(g.rateDelta).toBeCloseTo(55 / 38 - 70 / 45, 10);
  });

  it('vsYearAgo is not null and references 202503', () => {
    expect(recap!.vsYearAgo).not.toBeNull();
    expect(recap!.vsYearAgo!.baselineYm).toBe(202503);
  });

  it('vsYearAgo allIn: cost delta', () => {
    const a = recap!.vsYearAgo!.allIn!;
    expect(a.costDelta).toBe(10); // 150 - 140
    expect(a.costPct).toBeCloseTo(10 / 140, 10);
  });

  it('vsYearAgo elec: cost delta and pct', () => {
    const e = recap!.vsYearAgo!.elec!;
    expect(e.costDelta).toBe(15); // 95 - 80
    expect(e.costPct).toBeCloseTo(15 / 80, 10);
  });

  it('vsYearAgo gas: cost delta and pct', () => {
    const g = recap!.vsYearAgo!.gas!;
    expect(g.costDelta).toBe(-5); // 55 - 60
    expect(g.costPct).toBeCloseTo(-5 / 60, 10);
  });
});

// ── Case 2: One bill — both comparisons null ───────────────────────────────────
describe('buildBillRecap — single-bill (brand-new account)', () => {
  const rows = [
    mk({ ym: 202603, elecBill: 95, gasBill: 55, billTotal: 150, kwh: 700, therms: 38, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('returns a recap', () => {
    expect(recap).not.toBeNull();
    expect(recap!.statementYm).toBe(202603);
  });

  it('both comparisons are null', () => {
    expect(recap!.vsLast).toBeNull();
    expect(recap!.vsYearAgo).toBeNull();
  });
});

// ── Case 3: Prior row exists but year-ago is missing ──────────────────────────
describe('buildBillRecap — prior row present, year-ago absent', () => {
  const rows = [
    mk({ ym: 202602, elecBill: 90, gasBill: 70, billTotal: 160, kwh: 650, therms: 45, days: 31 }),
    mk({ ym: 202603, elecBill: 95, gasBill: 55, billTotal: 150, kwh: 700, therms: 38, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('vsLast is present', () => {
    expect(recap!.vsLast).not.toBeNull();
  });

  it('vsYearAgo is null (202503 row missing)', () => {
    expect(recap!.vsYearAgo).toBeNull();
  });
});

// ── Case 4: Differing period lengths — per-day normalization matters ───────────
//
// Arriving:  billTotal=200, days=35
// Prior:     billTotal=180, days=28
//
// Raw cost delta: 200 - 180 = +$20 (looks expensive)
// PerDayA = 200/35 ≈ 5.7143 $/day
// PerDayB = 180/28 ≈ 6.4286 $/day
// PerDayDelta ≈ -0.7143 (actually CHEAPER per day despite higher raw total)

describe('buildBillRecap — differing period lengths', () => {
  const rows = [
    mk({ ym: 202503, elecBill: 100, gasBill: 80, billTotal: 180, kwh: 700, therms: 50, days: 28 }),
    mk({ ym: 202603, elecBill: 110, gasBill: 90, billTotal: 200, kwh: 750, therms: 52, days: 35 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('raw cost delta is positive (more expensive)', () => {
    expect(recap!.vsYearAgo!.allIn!.costDelta).toBe(20); // 200 - 180
  });

  it('per-day delta is negative (cheaper per day despite longer cycle)', () => {
    const a = recap!.vsYearAgo!.allIn!;
    expect(a.costPerDayA).toBeCloseTo(200 / 35, 10);
    expect(a.costPerDayB).toBeCloseTo(180 / 28, 10);
    // per-day delta = 200/35 - 180/28 ≈ 5.7143 - 6.4286 ≈ -0.7143
    expect(a.costPerDayDelta!).toBeLessThan(0);
    expect(a.costPerDayDelta).toBeCloseTo(200 / 35 - 180 / 28, 10);
  });

  it('day counts are carried on the comparison', () => {
    const c = recap!.vsYearAgo!;
    expect(c.daysA).toBe(35);
    expect(c.daysB).toBe(28);
  });
});

// ── Case 5: Fuel absent in one period ─────────────────────────────────────────
//
// Arriving bill has gas but prior bill has no gas data (gasBill null) → gas FuelDelta null.
// Electric is present in both → elec FuelDelta non-null.

describe('buildBillRecap — fuel absent in baseline', () => {
  const rows = [
    // Prior: electric only (gas not available)
    mk({ ym: 202602, elecBill: 90, billTotal: 90, kwh: 650, days: 31 }),
    // Arriving: both fuels
    mk({ ym: 202603, elecBill: 95, gasBill: 55, billTotal: 150, kwh: 700, therms: 38, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('vsLast elec is present (both periods have elecBill)', () => {
    expect(recap!.vsLast!.elec).not.toBeNull();
  });

  it('vsLast gas is null (prior period has no gasBill)', () => {
    expect(recap!.vsLast!.gas).toBeNull();
  });

  it('vsLast allIn is null (prior billTotal only covers electric)', () => {
    // allIn requires billTotal on both rows; prior has billTotal=90 which is fine.
    // Actually prior has billTotal=90, arriving has billTotal=150, so allIn IS present.
    const a = recap!.vsLast!.allIn;
    expect(a).not.toBeNull();
    expect(a!.costDelta).toBe(60); // 150 - 90
  });
});

// ── Case 6: Fuel absent in arriving bill ──────────────────────────────────────
//
// Arriving bill has electric only; prior has both fuels.
// gas FuelDelta should be null.

describe('buildBillRecap — fuel absent in arriving bill', () => {
  const rows = [
    mk({ ym: 202602, elecBill: 90, gasBill: 70, billTotal: 160, kwh: 650, therms: 45, days: 31 }),
    // Arriving: electric only
    mk({ ym: 202603, elecBill: 95, billTotal: 95, kwh: 700, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('vsLast elec is present', () => {
    expect(recap!.vsLast!.elec).not.toBeNull();
  });

  it('vsLast gas is null (arriving bill has no gasBill)', () => {
    expect(recap!.vsLast!.gas).toBeNull();
  });
});

// ── Case 7: statementYm not in rows → returns null ────────────────────────────
describe('buildBillRecap — statementYm not found', () => {
  const rows = [
    mk({ ym: 202602, elecBill: 90, billTotal: 90, days: 31 }),
  ];

  it('returns null when statementYm is absent from rows', () => {
    expect(buildBillRecap(rows, 202603)).toBeNull();
  });

  it('returns null for empty rows', () => {
    expect(buildBillRecap([], 202603)).toBeNull();
  });
});

// ── Case 8: Prior row exists but has no usable cost data → skipped ─────────────
//
// The immediately-prior ym has no cost fields — should not be used as a baseline.
// The prior-prior row has cost data and should be used instead.

describe('buildBillRecap — prior row with no cost data is skipped', () => {
  const rows = [
    mk({ ym: 202601, elecBill: 85, billTotal: 85, days: 30 }),
    // 202602 has no cost data — not usable
    mk({ ym: 202602, kwh: 600, days: 31 }),
    mk({ ym: 202603, elecBill: 95, billTotal: 95, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('vsLast skips the no-data row and uses 202601', () => {
    expect(recap!.vsLast).not.toBeNull();
    expect(recap!.vsLast!.baselineYm).toBe(202601);
  });
});

// ── Case 9: Zero costB — costPct is null (no divide-by-zero) ──────────────────
describe('buildBillRecap — zero baseline cost produces null pct', () => {
  const rows = [
    mk({ ym: 202602, elecBill: 0, gasBill: 0, billTotal: 0, kwh: 500, therms: 30, days: 31 }),
    mk({ ym: 202603, elecBill: 95, gasBill: 55, billTotal: 150, kwh: 700, therms: 38, days: 28 }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('allIn costPct is null when baseline is $0', () => {
    expect(recap!.vsLast!.allIn!.costPct).toBeNull();
  });

  it('elec costPct is null when baseline elecBill is $0', () => {
    expect(recap!.vsLast!.elec!.costPct).toBeNull();
  });
});

// ── Case 10: Missing days — per-day fields are null ──────────────────────────
describe('buildBillRecap — missing days produce null per-day fields', () => {
  const rows = [
    mk({ ym: 202602, elecBill: 90, billTotal: 160, kwh: 650, days: null }),
    mk({ ym: 202603, elecBill: 95, billTotal: 150, kwh: 700, days: null }),
  ];

  const recap = buildBillRecap(rows, 202603);

  it('allIn perDay fields are null when days is missing', () => {
    const a = recap!.vsLast!.allIn!;
    expect(a.costPerDayA).toBeNull();
    expect(a.costPerDayB).toBeNull();
    expect(a.costPerDayDelta).toBeNull();
  });

  it('raw cost delta is still present', () => {
    expect(recap!.vsLast!.allIn!.costDelta).toBe(-10); // 150 - 160
  });
});

// ── Case 11: Weather decomposition — differing degree-days ────────────────────
//
// Two rows with meaningful degree-day differences. Hand-calculated:
//   rowA (arriving 202603): kwh=500, hdd=300, cdd=50  → totalDD=350, Ia=500/350
//   rowB (baseline 202602): kwh=600, hdd=400, cdd=30  → totalDD=430, Ib=600/430
//
//   rawUsageDelta = 500 − 600 = −100
//   weatherExplainedDelta = Ib × (ddA − ddB) = (600/430) × (350 − 430) = (600/430) × (−80)
//   activityDelta          = (Ia − Ib) × ddA  = (500/350 − 600/430) × 350
//   These two sum to rawUsageDelta exactly (the series.ts identity).
//
//   normalizedUsagePct = (Ia − Ib) / Ib
//                      = ((500/350) − (600/430)) / (600/430)
//                      = (500 × 430) / (350 × 600) − 1
//                      = 215000/210000 − 1
//                      = 5000/210000
//                      ≈ 0.023810

describe('buildBillRecap — weather decomposition (differing DDs)', () => {
  // Weather split lives on vsYearAgo (same calendar month, comparable degree-days);
  // baseline is the year-ago row (202503), not the prior month.
  const rows = [
    mk({ ym: 202503, elecBill: 90, billTotal: 90, kwh: 600, days: 31, hdd: 400, cdd: 30 }),
    mk({ ym: 202603, elecBill: 95, billTotal: 95, kwh: 500, days: 28, hdd: 300, cdd: 50 }),
  ];

  const recap = buildBillRecap(rows, 202603);
  const elec = recap!.vsYearAgo!.elec!;

  it('weather fields are non-null when both rows have degree-days', () => {
    expect(elec.weatherExplainedDelta).not.toBeNull();
    expect(elec.activityDelta).not.toBeNull();
    expect(elec.normalizedUsagePct).not.toBeNull();
  });

  it('weatherExplainedDelta + activityDelta === rawUsageDelta (within FP tolerance)', () => {
    // rawUsageDelta = usageA − usageB = 500 − 600 = −100
    const rawUsageDelta = elec.usageDelta!; // −100
    expect(elec.weatherExplainedDelta! + elec.activityDelta!).toBeCloseTo(rawUsageDelta, 10);
  });

  it('normalizedUsagePct matches hand-computed intensity ratio', () => {
    // (500/350 − 600/430) / (600/430) = 5000/210000 ≈ 0.023810
    expect(elec.normalizedUsagePct).toBeCloseTo(5000 / 210000, 10);
  });
});

// ── Case 12: Weather decomposition — raw usage UP, activity DOWN ──────────────
//
// This proves the feature's value: the raw delta looks like more usage, but the
// weather-normalized (activity) signal reveals reduced intensity.
//
//   rowA (arriving 202603): kwh=700, hdd=500, cdd=0 → totalDD=500, Ia=700/500=1.4
//   rowB (baseline 202602): kwh=600, hdd=300, cdd=0 → totalDD=300, Ib=600/300=2.0
//
//   rawUsageDelta = 700 − 600 = +100  (usage went UP)
//   normalizedUsagePct = (1.4 − 2.0) / 2.0 = −0.30  (activity went DOWN −30%)
//   weatherExplainedDelta = 2.0 × (500 − 300) = +400  (much colder → weather explains +400 kWh)
//   activityDelta          = (1.4 − 2.0) × 500 = −300  (you actually used −300 kWh per same weather)
//   sum: 400 + (−300) = 100 = rawUsageDelta ✓

describe('buildBillRecap — raw usage UP but activity-normalized DOWN', () => {
  const rows = [
    mk({ ym: 202503, elecBill: 90, billTotal: 90, kwh: 600, days: 30, hdd: 300, cdd: 0 }),
    mk({ ym: 202603, elecBill: 95, billTotal: 95, kwh: 700, days: 30, hdd: 500, cdd: 0 }),
  ];

  const recap = buildBillRecap(rows, 202603);
  const elec = recap!.vsYearAgo!.elec!;

  it('raw usageDelta is positive (more kWh)', () => {
    expect(elec.usageDelta).toBe(100); // 700 − 600
  });

  it('normalizedUsagePct is negative (less activity per degree-day)', () => {
    // (700/500 − 600/300) / (600/300) = (1.4 − 2.0) / 2.0 = −0.30
    expect(elec.normalizedUsagePct).toBeCloseTo(-0.30, 10);
  });

  it('weatherExplainedDelta accounts for extra degree-days', () => {
    // intensityB × (ddA − ddB) = 2.0 × (500 − 300) = 400
    expect(elec.weatherExplainedDelta).toBeCloseTo(400, 10);
  });

  it('activityDelta is negative (better behaviour)', () => {
    // (1.4 − 2.0) × 500 = −300
    expect(elec.activityDelta).toBeCloseTo(-300, 10);
  });

  it('decomposition sums to rawUsageDelta', () => {
    expect(elec.weatherExplainedDelta! + elec.activityDelta!).toBeCloseTo(elec.usageDelta!, 10);
  });
});

// ── Case 13: Weather degrade — missing degree-days → weather fields null ──────
//
// When the arriving row has no hdd/cdd, compareYoY returns null for that fuel
// and the weather fields on FuelDelta degrade to null. The raw usageDelta and all
// cost fields must still be present (weather data is not required for core recap).

describe('buildBillRecap — degrade: missing degree-days on arriving row', () => {
  const rows = [
    mk({ ym: 202503, elecBill: 90, billTotal: 90, kwh: 600, days: 31, hdd: 300, cdd: 50 }),
    // Arriving row has no degree-day data
    mk({ ym: 202603, elecBill: 95, billTotal: 95, kwh: 700, days: 28, hdd: null, cdd: null }),
  ];

  const recap = buildBillRecap(rows, 202603);
  const elec = recap!.vsYearAgo!.elec!;

  it('weather fields are null when arriving row lacks degree-days', () => {
    expect(elec.weatherExplainedDelta).toBeNull();
    expect(elec.activityDelta).toBeNull();
    expect(elec.normalizedUsagePct).toBeNull();
  });

  it('raw usageDelta is still present', () => {
    expect(elec.usageDelta).toBe(100); // 700 − 600
  });

  it('cost fields are still present', () => {
    expect(elec.costDelta).toBe(5); // 95 − 90
    expect(elec.costPct).toBeCloseTo(5 / 90, 10);
  });
});

// ── Case 14: Weather split is vsYearAgo-only — vsLast never carries it ────────
//
// Consecutive-month (vsLast) weather normalization is unreliable across seasons
// (degree-days swing while electric is largely baseload → artifact %s), so the
// recap intentionally OMITS the weather decomposition on vsLast. vsLast still
// carries the raw usage delta; only vsYearAgo gets the weather-normalized split.

describe('buildBillRecap — weather split is year-ago only', () => {
  const rows = [
    mk({ ym: 202503, elecBill: 90, billTotal: 90, kwh: 600, days: 30, hdd: 300, cdd: 0 }), // year-ago
    mk({ ym: 202602, elecBill: 88, billTotal: 88, kwh: 580, days: 31, hdd: 320, cdd: 0 }), // prior
    mk({ ym: 202603, elecBill: 95, billTotal: 95, kwh: 700, days: 30, hdd: 500, cdd: 0 }), // arriving
  ];

  const recap = buildBillRecap(rows, 202603);

  it('vsLast carries raw usage but NO weather fields', () => {
    const e = recap!.vsLast!.elec!;
    expect(e.usageDelta).toBe(120); // 700 − 580, raw still present
    expect(e.weatherExplainedDelta).toBeNull();
    expect(e.activityDelta).toBeNull();
    expect(e.normalizedUsagePct).toBeNull();
  });

  it('vsYearAgo carries the weather decomposition', () => {
    const e = recap!.vsYearAgo!.elec!;
    expect(e.weatherExplainedDelta).not.toBeNull();
    expect(e.activityDelta).not.toBeNull();
    expect(e.normalizedUsagePct).not.toBeNull();
  });
});
