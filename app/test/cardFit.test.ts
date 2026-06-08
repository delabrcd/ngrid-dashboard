import { describe, expect, it } from 'vitest';
import {
  contentDetailThresholdPx,
  detailHeightPx,
  essentialHeightPx,
  pxToMinRows,
  showDetailAt,
} from '../src/lib/widgets/cardFit';

// Card-fit threshold tests (issue #73 content-fit). The arithmetic that decides a
// stat card's minimum height and when its detail line hides is PURE, so it's
// hand-calculated here. The component + the globals.css container query MIRROR
// these numbers, so fencing them keeps the three in lock-step.

describe('essentialHeightPx (hand-calculated)', () => {
  it('simple card = padding + title + headline', () => {
    // 24 (p-3) + 16 (title) + 32 (headline) = 72
    expect(essentialHeightPx('simple')).toBe(72);
  });
  it('budget card also reserves the progress bar', () => {
    // 72 + 12 (bar + its margin) = 84
    expect(essentialHeightPx('budget')).toBe(84);
  });
});

describe('detailHeightPx (hand-calculated)', () => {
  it('simple card fits the detail line at essential + 16', () => {
    expect(detailHeightPx('simple')).toBe(88); // 72 + 16
  });
  it('budget card needs more height before the sub line fits', () => {
    expect(detailHeightPx('budget')).toBe(100); // 84 + 16
  });
});

describe('contentDetailThresholdPx — the CSS container-query threshold (content box)', () => {
  it('is detailHeightPx minus the card padding (a @container query measures content-box)', () => {
    // simple: 88 − 24 (p-3) = 64; budget: 100 − 24 = 76. These are the exact
    // values the globals.css `@container (max-height: …)` rules threshold on
    // (minus 1px) — keeping the CSS and this module in lock-step.
    expect(contentDetailThresholdPx('simple')).toBe(64);
    expect(contentDetailThresholdPx('budget')).toBe(76);
  });
});

describe('showDetailAt — the hide-the-sub-line rule (hand-calculated)', () => {
  it('shows the detail line at/above the detail threshold', () => {
    expect(showDetailAt(88, 'simple')).toBe(true);
    expect(showDetailAt(120, 'simple')).toBe(true);
    expect(showDetailAt(100, 'budget')).toBe(true);
  });
  it('HIDES the detail line below the threshold (so it never overflows)', () => {
    expect(showDetailAt(87, 'simple')).toBe(false);
    expect(showDetailAt(72, 'simple')).toBe(false); // exactly the essential block
    expect(showDetailAt(99, 'budget')).toBe(false); // budget needs 100
  });
  it('a budget card at a simple card’s detail height still hides (bar reserved)', () => {
    // 88px fits a simple card's sub line but NOT a budget card's (it needs 100).
    expect(showDetailAt(88, 'simple')).toBe(true);
    expect(showDetailAt(88, 'budget')).toBe(false);
  });
});

describe('pxToMinRows — content px → grid-row minH (hand-calculated)', () => {
  it('ceils so the rows cover the required pixels: n ≥ (px + m)/(rh + m)', () => {
    // essential 72px at rowHeight 32, margin 8: (72+8)/(32+8) = 80/40 = 2 → 2 rows.
    expect(pxToMinRows(72, 32, 8)).toBe(2);
    // budget 84px: (84+8)/40 = 92/40 = 2.3 → ceil → 3 rows.
    expect(pxToMinRows(84, 32, 8)).toBe(3);
  });
  it('n rows actually cover the px (n*rh + (n-1)*m ≥ px)', () => {
    for (const px of [72, 84, 100, 150]) {
      const n = pxToMinRows(px, 32, 8);
      expect(n * 32 + (n - 1) * 8).toBeGreaterThanOrEqual(px);
      // And n-1 rows would NOT cover it (n is the minimal sufficient row count).
      if (n > 1) expect((n - 1) * 32 + (n - 2) * 8).toBeLessThan(px);
    }
  });
  it('clamps to at least 1 row', () => {
    expect(pxToMinRows(0, 32, 8)).toBe(1);
    expect(pxToMinRows(10, 32, 8)).toBe(1);
  });
});
