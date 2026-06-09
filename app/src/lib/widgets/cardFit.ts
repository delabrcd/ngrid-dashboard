// Pure card-fit arithmetic (issue #73 content-fit; compact-stat-cards iteration).
// The operator's rule for the compact strip: a stat card's DEFAULT body is just
// its (brief) title + the headline value (plus the progress bar for the budget
// card) — the old sub/detail line moved into the ⓘ tooltip, so it no longer takes
// card space. This module owns the load-bearing PIXEL ARITHMETIC behind the card's
// minimum height: the height a card's ESSENTIAL content needs, which IS the whole
// body now (there's no optional detail line to hide). Kept here, NO React / DOM, so
// it's hand-calc unit-tested the same way the rest of lib/ is — and so the
// registry's grid `minH` derives from ONE set of numbers, not hand-tuned guesses
// scattered across files.
//
// The numbers are measured against the card's actual markup (StatCard.tsx) at the
// theme's type scale, with the COMPACT `!p-2` padding (down from `!p-3`). The card
// is border-box (Tailwind default), so a tile's px height must cover the card's
// 1px top + 1px bottom BORDER on top of its padding + content — otherwise the
// content area is 2px short and the headline clips by a hair (caught by the headless
// scrollHeight check). We fold that 2px in:
//   • card border (`.card`)            → 1px top + 1px bottom = 2px
//   • card padding (`!p-2`)            → 8px top + 8px bottom = 16px
//   • title  (`card-title text-xs`)    → ~16px line box
//   • headline (`stat text-2xl`)       → ~32px line box
//   • progress bar (budget only)       → ~6px bar + ~6px top margin = 12px
// These are deliberately rounded UP a hair: erring toward a slightly taller floor
// is fine; letting content overflow the card is not.

// One stat card's content geometry, in CSS px. `kind` distinguishes the budget
// card (which also reserves a progress bar in its essential block) from the
// simple/yoy cards (title + headline only).
export type StatCardKind = 'simple' | 'budget';

const CARD_BORDER_Y = 2; // .card border → 1 top + 1 bottom (border-box)
const CARD_PADDING_Y = 16; // !p-2 → 8 top + 8 bottom
const TITLE_H = 16; // card-title text-xs
const HEADLINE_H = 32; // stat text-2xl
const BAR_H = 12; // budget progress bar + its top margin

// The ESSENTIAL (border-box) height a card needs: border + padding + title +
// headline (+ the budget bar). With the detail line gone this IS the card's full
// content height, so this is the grid `minH` floor the registry derives its row
// count from — a card can't be resized shorter than the height that fits title +
// headline (+ bar) without clipping.
export function essentialHeightPx(kind: StatCardKind): number {
  return CARD_BORDER_Y + CARD_PADDING_Y + TITLE_H + HEADLINE_H + (kind === 'budget' ? BAR_H : 0);
}

// Convert an essential pixel height into a grid-ROW minimum for a given runtime
// rowHeight + RGL margin, so the registry's `minH` tracks the SAME content
// arithmetic. n rows span n*rowHeight + (n−1)*margin px of content (the inter-row
// margins inside a multi-row tile); we ceil so the rows always cover the required
// pixels. Clamped to ≥1. PURE — hand-calc unit-tested.
export function pxToMinRows(px: number, rowHeight: number, marginY: number): number {
  const rh = Math.max(1, rowHeight);
  // Solve n*rh + (n−1)*m ≥ px  →  n ≥ (px + m) / (rh + m).
  const n = Math.ceil((px + marginY) / (rh + marginY));
  return Math.max(1, n);
}
