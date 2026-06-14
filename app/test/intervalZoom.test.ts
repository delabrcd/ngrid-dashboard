import { describe, expect, it } from 'vitest';
import {
  msToYmd,
  zoomSpanToRange,
  isZoomSelectionSignificant,
} from '../src/lib/intervalZoom';

// Hand-calculated tests for the PURE interval-zoom helpers (issue #141). The
// helpers map a drag-selected span to /api/interval day bounds and decide whether
// a drag is deliberate enough to zoom (vs an accidental click). NO infra — pure
// number/string math.

const HOUR = 3_600_000;
const MINUTE = 60_000;

describe('msToYmd (hand-calculated)', () => {
  it('formats an epoch-ms instant as its UTC calendar day', () => {
    // 2026-06-08T18:00:00Z → UTC day 2026-06-08
    expect(msToYmd(Date.parse('2026-06-08T18:00:00Z'))).toBe('2026-06-08');
  });

  it('uses the UTC day even late in a US-eastern evening (no local-day shift)', () => {
    // 2026-06-09T03:30:00Z is still 2026-06-09 in UTC (23:30 the prior day in EDT);
    // we intentionally key off the UTC day to match the route's UTC bounds parsing.
    expect(msToYmd(Date.parse('2026-06-09T03:30:00Z'))).toBe('2026-06-09');
  });

  it('zero-pads single-digit month and day', () => {
    expect(msToYmd(Date.UTC(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});

describe('zoomSpanToRange (hand-calculated)', () => {
  it('maps an ascending span to inclusive UTC day bounds', () => {
    const start = Date.parse('2026-06-08T06:00:00Z');
    const end = Date.parse('2026-06-10T22:00:00Z');
    expect(zoomSpanToRange(start, end)).toEqual({ from: '2026-06-08', to: '2026-06-10' });
  });

  it('orders a backwards drag so from ≤ to', () => {
    const start = Date.parse('2026-06-10T22:00:00Z');
    const end = Date.parse('2026-06-08T06:00:00Z');
    expect(zoomSpanToRange(start, end)).toEqual({ from: '2026-06-08', to: '2026-06-10' });
  });

  it('collapses a within-one-day span to a single day on both bounds', () => {
    const start = Date.parse('2026-06-08T06:00:00Z');
    const end = Date.parse('2026-06-08T20:00:00Z');
    expect(zoomSpanToRange(start, end)).toEqual({ from: '2026-06-08', to: '2026-06-08' });
  });
});

describe('isZoomSelectionSignificant (hand-calculated)', () => {
  // Minimum deliberate-drag span: 30 minutes (two adjacent 15-min points jittered
  // under a click should NOT zoom; a genuine drag across ≥30 min does).
  const MIN = 30 * MINUTE;
  const base = Date.UTC(2026, 5, 8, 6, 0, 0);

  it('zooms a deliberate multi-hour drag across distinct indices', () => {
    // indices 10≠40, span 6h ≥ 30min → significant.
    expect(isZoomSelectionSignificant(10, 40, base, base + 6 * HOUR, MIN)).toBe(true);
  });

  it('rejects a click (same index on down and up)', () => {
    // A single click lands both endpoints on index 25 → not significant even if
    // the ms happened to differ.
    expect(isZoomSelectionSignificant(25, 25, base, base + HOUR, MIN)).toBe(false);
  });

  it('rejects a sub-minimum jitter-drag across adjacent points', () => {
    // indices differ (12 vs 13) but only 15 min apart < 30 min → not significant.
    expect(isZoomSelectionSignificant(12, 13, base, base + 15 * MINUTE, MIN)).toBe(false);
  });

  it('zooms at exactly the minimum span (inclusive boundary)', () => {
    // indices differ and span == 30 min == MIN → significant.
    expect(isZoomSelectionSignificant(12, 14, base, base + 30 * MINUTE, MIN)).toBe(true);
  });

  it('is order-independent (a backwards drag is still significant)', () => {
    // end index < start index, end ms < start ms; abs span 6h ≥ 30min → significant.
    expect(isZoomSelectionSignificant(40, 10, base + 6 * HOUR, base, MIN)).toBe(true);
  });

  it('rejects non-finite endpoints', () => {
    expect(isZoomSelectionSignificant(NaN, 10, base, base + HOUR, MIN)).toBe(false);
    expect(isZoomSelectionSignificant(0, 10, NaN, base + HOUR, MIN)).toBe(false);
  });
});
