import { describe, expect, it } from 'vitest';
import type { MonthRow } from '../src/lib/chartSpec';
import {
  detectAnomalies,
  THRESHOLD_K,
  MAD_SCALE,
  MIN_TRAILING,
  FLAT_REL_BAND,
} from '../src/lib/anomaly';

// Minimal MonthRow factory (mirrors the other pure-series tests). Only the
// weather-normalized intensities (kwhPerDegreeDay/thermsPerHdd) and all-in rates
// (elecRateAllIn/gasRateAllIn) feed the anomaly math; everything else is null.
const mkRow = (over: Partial<MonthRow>): MonthRow => ({
  ym: 0, label: '', kwh: null, therms: null,
  elecSupply: null, gasSupply: null, elecDelivery: null, gasDelivery: null,
  elecBill: null, gasBill: null,
  elecRateSupply: null, gasRateSupply: null, elecRateAllIn: null, gasRateAllIn: null,
  avgTemp: null, billTotal: null, days: null,
  hdd: null, cdd: null, kwhPerDegreeDay: null, thermsPerHdd: null, ...over,
});

// Build an electric-USAGE series: rows carry kwhPerDegreeDay (the weather-
// normalized intensity), so usage anomalies are evaluated on a value that already
// removed the weather. ym just increments monthly.
const elecUsage = (intensities: number[]): MonthRow[] =>
  intensities.map((v, i) => mkRow({ ym: 202401 + i, kwhPerDegreeDay: v }));

describe('detectAnomalies — documented robust thresholding', () => {
  it('exports the documented constants', () => {
    expect(THRESHOLD_K).toBe(3.5);
    expect(MAD_SCALE).toBe(1.4826);
    expect(MIN_TRAILING).toBe(4);
    expect(FLAT_REL_BAND).toBe(0.2);
  });

  // ── REQUIRED CASE 1: a cold-but-NORMAL month does NOT flag. ────────────────
  //
  // A cold month uses MORE total kWh, but the weather-normalized intensity
  // (kWh per degree-day) is unchanged because the colder weather (more
  // degree-days) is already divided out. So even though raw usage would spike,
  // the intensity stays in-band and nothing flags. The candidate intensity here
  // is bang on the trailing median.
  //
  // Trailing intensities: 1.00, 1.05, 0.98, 1.02, 1.00 (a steady efficient home).
  //   median(trailing) = 1.00
  //   abs deviations from 1.00: 0.00, 0.05, 0.02, 0.02, 0.00 -> sorted 0,0,0.02,0.02,0.05
  //   MAD = median = 0.02 ; robust = 1.4826 * 0.02 = 0.029652
  // Candidate (the cold month, but normal intensity): 1.01.
  //   diff = 0.01 ; deviations = 0.01 / 0.029652 = 0.337 -> well under 3.5 -> NO flag.
  it('does NOT flag a cold-but-normal month (intensity unchanged)', () => {
    const rows = elecUsage([1.0, 1.05, 0.98, 1.02, 1.0, 1.01]);
    const { flags } = detectAnomalies(rows);
    expect(flags).toHaveLength(0);
  });

  // ── REQUIRED CASE 2: a true efficiency regression DOES flag. ───────────────
  //
  // Same steady trailing baseline (median 1.00, robust spread 0.029652), but the
  // latest month's weather-normalized intensity jumps to 1.30 — i.e. 30% more
  // energy per degree-day than usual, AFTER weather is removed. That's a genuine
  // regression (failing appliance / new always-on load), not the weather.
  //   diff = 1.30 − 1.00 = 0.30
  //   deviations = 0.30 / 0.029652 = 10.12 -> > 3.5 -> FLAG.
  //   pct = 0.30 / 1.00 = +0.30 -> "~30% above weather-normalized expectation".
  it('flags a true efficiency regression (intensity spike, weather removed)', () => {
    const rows = elecUsage([1.0, 1.05, 0.98, 1.02, 1.0, 1.3]);
    const { flags, ym } = detectAnomalies(rows);
    expect(flags).toHaveLength(1);
    const f = flags[0];
    expect(f.fuel).toBe('elec');
    expect(f.metric).toBe('usage');
    expect(f.direction).toBe('above');
    expect(f.ym).toBe(202406);
    expect(ym).toBe(202406);
    expect(f.median).toBeCloseTo(1.0, 10);
    expect(f.latest).toBe(1.3);
    expect(f.pct).toBeCloseTo(0.3, 10);
    expect(f.deviations).toBeCloseTo(0.3 / (MAD_SCALE * 0.02), 6);
    expect(f.message).toBe('electric usage ~30% above weather-normalized expectation');
  });

  // A genuinely LOWER intensity (efficiency improvement / behaviour change) flags
  // as 'below' — the direction classification works both ways.
  it('flags a downward intensity break as "below"', () => {
    // Baseline median 1.00, robust 0.029652; candidate 0.70 -> diff −0.30,
    // deviations 10.12 > 3.5 -> flag, direction below, pct −0.30.
    const rows = elecUsage([1.0, 1.05, 0.98, 1.02, 1.0, 0.7]);
    const { flags } = detectAnomalies(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].direction).toBe('below');
    expect(flags[0].pct).toBeCloseTo(-0.3, 10);
    expect(flags[0].message).toBe('electric usage ~30% below weather-normalized expectation');
  });

  // A modest bump that's BIGGER than the median but still inside the robust band
  // must NOT flag — robustness keeps normal variability quiet.
  it('does NOT flag a deviation inside the robust band', () => {
    // Baseline median 1.00, robust 0.029652. Candidate 1.05 -> diff 0.05,
    // deviations = 0.05 / 0.029652 = 1.69 < 3.5 -> no flag.
    const rows = elecUsage([1.0, 1.05, 0.98, 1.02, 1.0, 1.05]);
    expect(detectAnomalies(rows).flags).toHaveLength(0);
  });
});

describe('detectAnomalies — rate jump (ESCO / supply-rate change)', () => {
  // The all-in $/unit moving outside its recent band catches a supply-rate or
  // ESCO switch that the weather-normalized usage check can't see. elecRateAllIn
  // is currentCharges-derived (series.ts), never totalDueAmount.
  const elecRate = (rates: number[]): MonthRow[] =>
    rates.map((v, i) => mkRow({ ym: 202401 + i, elecRateAllIn: v }));

  it('flags an all-in rate jump (supply-rate / ESCO change)', () => {
    // Trailing rates: 0.20, 0.21, 0.20, 0.19, 0.20 -> median 0.20.
    //   abs devs: 0, .01, 0, .01, 0 -> sorted 0,0,0,.01,.01 -> MAD = 0
    //   MAD is 0 -> flat-MAD fallback band = ±FLAT_REL_BAND(0.20) * 0.20 = ±0.04.
    // Candidate 0.26 -> diff +0.06 > 0.04 -> FLAG. pct = 0.06/0.20 = +0.30.
    // deviations is Infinity on the flat-MAD path.
    const rows = elecRate([0.2, 0.21, 0.2, 0.19, 0.2, 0.26]);
    const { flags } = detectAnomalies(rows);
    expect(flags).toHaveLength(1);
    expect(flags[0].metric).toBe('rate');
    expect(flags[0].direction).toBe('above');
    expect(flags[0].pct).toBeCloseTo(0.3, 10);
    expect(flags[0].deviations).toBe(Number.POSITIVE_INFINITY);
    expect(flags[0].message).toBe('electric rate ~30% above recent rate band');
  });

  it('does NOT flag a small rate wobble within the flat-MAD fallback band', () => {
    // Same flat baseline (median 0.20, MAD 0 -> band ±0.04). Candidate 0.22 ->
    // diff +0.02 < 0.04 -> no flag.
    const rows = elecRate([0.2, 0.21, 0.2, 0.19, 0.2, 0.22]);
    expect(detectAnomalies(rows).flags).toHaveLength(0);
  });
});

describe('detectAnomalies — guards', () => {
  it('returns no flags and null ym for an empty series', () => {
    expect(detectAnomalies([])).toEqual({ flags: [], ym: null });
  });

  it('requires MIN_TRAILING baseline observations before flagging', () => {
    // Only 4 rows total = 3 trailing + 1 candidate; below MIN_TRAILING(4) + 1, so
    // even a wild candidate can't flag (too thin a baseline to call an outlier).
    const rows = elecUsage([1.0, 1.0, 1.0, 5.0]);
    const { flags, ym } = detectAnomalies(rows);
    expect(flags).toHaveLength(0);
    // ym still references the latest evaluable period for a stable dedupe key.
    expect(ym).toBe(202404);
  });

  it('ignores rows missing the metric (gaps do not break the baseline)', () => {
    // Mixed: some rows carry only gas intensity. Electric still evaluates on its
    // own present rows. Here electric has a clean baseline then a spike.
    const rows: MonthRow[] = [
      mkRow({ ym: 202401, kwhPerDegreeDay: 1.0, thermsPerHdd: 0.1 }),
      mkRow({ ym: 202402, kwhPerDegreeDay: 1.0 }),
      mkRow({ ym: 202403, kwhPerDegreeDay: 1.02 }),
      mkRow({ ym: 202404, kwhPerDegreeDay: 0.98 }),
      mkRow({ ym: 202405, kwhPerDegreeDay: 1.0 }),
      mkRow({ ym: 202406, kwhPerDegreeDay: 1.5 }), // spike
    ];
    const { flags } = detectAnomalies(rows);
    expect(flags.some((f) => f.fuel === 'elec' && f.metric === 'usage')).toBe(true);
  });

  it('reports multiple independent flags (usage AND rate, both fuels)', () => {
    // Electric usage spike + gas rate spike in the same latest period.
    const rows: MonthRow[] = [
      mkRow({ ym: 202401, kwhPerDegreeDay: 1.0, gasRateAllIn: 1.0 }),
      mkRow({ ym: 202402, kwhPerDegreeDay: 1.0, gasRateAllIn: 1.0 }),
      mkRow({ ym: 202403, kwhPerDegreeDay: 1.02, gasRateAllIn: 1.0 }),
      mkRow({ ym: 202404, kwhPerDegreeDay: 0.98, gasRateAllIn: 1.0 }),
      mkRow({ ym: 202405, kwhPerDegreeDay: 1.0, gasRateAllIn: 1.0 }),
      mkRow({ ym: 202406, kwhPerDegreeDay: 1.5, gasRateAllIn: 1.6 }),
    ];
    const { flags } = detectAnomalies(rows);
    expect(flags.some((f) => f.fuel === 'elec' && f.metric === 'usage')).toBe(true);
    expect(flags.some((f) => f.fuel === 'gas' && f.metric === 'rate')).toBe(true);
  });

  it('respects opts.thresholdK override', () => {
    // Candidate 1.05 -> 1.69 deviations: under default 3.5 (no flag) but over a
    // lowered threshold of 1.0 (flag).
    const rows = elecUsage([1.0, 1.05, 0.98, 1.02, 1.0, 1.05]);
    expect(detectAnomalies(rows).flags).toHaveLength(0);
    expect(detectAnomalies(rows, { thresholdK: 1.0 }).flags).toHaveLength(1);
  });
});
