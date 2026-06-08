// Pure card-fit thresholds (issue #73 content-fit fix). The operator's rule:
// "set minimum sizes that fit all card content, hide detail text to hit the
// minimum, but text must NEVER flow off the widget." This module owns the
// load-bearing PIXEL ARITHMETIC behind that — the minimum height a stat card's
// ESSENTIAL content (title + headline, plus the progress bar for the budget
// card) needs, and the height THRESHOLD below which the optional detail/sub line
// is hidden so it can never overflow the tile. Kept here, NO React / DOM, so it's
// hand-calc unit-tested the same way the rest of lib/ is — and so the CSS
// container-query thresholds in globals.css and the registry's grid `minH` derive
// from ONE set of numbers, not three hand-tuned guesses scattered across files.
//
// The numbers are measured against the card's actual markup (StatCard.tsx) at the
// theme's type scale:
//   • card padding (`!p-3`)           → 12px top + 12px bottom = 24px
//   • title  (`card-title text-xs`)   → ~16px line box
//   • headline (`stat text-2xl`)      → ~32px line box
//   • progress bar (budget only)      → ~6px bar + ~6px top margin = 12px
//   • detail/sub line (`text-[11px]`) → ~16px line box (incl. its mt-0.5)
// These are deliberately rounded UP a hair: erring toward hiding the sub line a
// pixel early is fine; letting it overflow the card is not.

// One stat card's content geometry, in CSS px. `kind` distinguishes the budget
// card (which also reserves a progress bar in its essential block) from the
// simple/yoy cards (title + headline only).
export type StatCardKind = 'simple' | 'budget';

const CARD_PADDING_Y = 24; // !p-3 → 12 top + 12 bottom
const TITLE_H = 16; // card-title text-xs
const HEADLINE_H = 32; // stat text-2xl
const BAR_H = 12; // budget progress bar + its top margin
const DETAIL_H = 16; // the sub/detail line (text-[11px]) incl. mt-0.5

// The ESSENTIAL height a card needs: padding + title + headline (+ the budget
// bar). Below this the card can't show its essentials, so this is the grid `minH`
// floor the registry derives its row count from — a card can't be resized
// shorter than the height that fits title + headline (+ bar).
export function essentialHeightPx(kind: StatCardKind): number {
  return CARD_PADDING_Y + TITLE_H + HEADLINE_H + (kind === 'budget' ? BAR_H : 0);
}

// The height at/above which the OPTIONAL detail (sub) line also fits without
// overflowing: the essential block + the detail line. At or above this we show
// the sub line; below it we hide the sub line (but still show title + headline).
export function detailHeightPx(kind: StatCardKind): number {
  return essentialHeightPx(kind) + DETAIL_H;
}

// Should the detail/sub line render at this card height? True iff the card is tall
// enough to fit the detail line below its essential block — so the sub line is
// shown only when it fits and is hidden (never clipped/overflowing) when it
// wouldn't. PURE — the component mirrors this with a CSS container query, and a
// JS fallback uses it directly against a measured height. `heightPx` is the card's
// FULL (border-box) height — the same number a tile's px height is.
export function showDetailAt(heightPx: number, kind: StatCardKind): boolean {
  return heightPx >= detailHeightPx(kind);
}

// The CSS-container-query threshold for the detail line, in CONTENT-BOX px (i.e.
// detailHeightPx MINUS the card's own vertical padding). A CSS `@container
// (max-height: …)` query measures the query container's CONTENT box, NOT its
// border box — so the container query in globals.css must threshold on this value
// (detailHeightPx − padding), not on detailHeightPx. We hide the detail one px
// below this (max-height: contentDetailThresholdPx − 1) so the line disappears the
// moment it wouldn't fully fit. Exposed so the CSS thresholds and this module
// derive from ONE arithmetic; the numbers are asserted in the unit tests. PURE.
export function contentDetailThresholdPx(kind: StatCardKind): number {
  return detailHeightPx(kind) - CARD_PADDING_Y;
}

// Convert an essential/detail pixel height into a grid-ROW minimum for a given
// runtime rowHeight + RGL margin, so the registry's `minH` tracks the SAME
// content arithmetic. n rows span n*rowHeight + (n−1)*margin px of content (the
// inter-row margins inside a multi-row tile); we ceil so the rows always cover
// the required pixels. Clamped to ≥1. PURE — hand-calc unit-tested.
export function pxToMinRows(px: number, rowHeight: number, marginY: number): number {
  const rh = Math.max(1, rowHeight);
  // Solve n*rh + (n−1)*m ≥ px  →  n ≥ (px + m) / (rh + m).
  const n = Math.ceil((px + marginY) / (rh + marginY));
  return Math.max(1, n);
}
