// PURE zoom math for the IntervalHistory widget (issue #141). The history chart
// is zoomed by DRAG-SELECT (a classic stock-chart gesture): the user drags a band
// across the chart and the widget refetches /api/interval for just that span so
// they see finer (less server-downsampled) detail. The zoom is local — it never
// touches the global RangeControl.
//
// This module owns the two number/shaping decisions so they can be hand-calc
// unit-tested in isolation: (1) mapping a dragged [startMs, endMs] span to the
// route's YYYY-MM-DD day bounds, and (2) deciding whether a drag-selection is
// deliberate enough to zoom (vs an accidental click). NO React / DOM / DB / fetch
// dependency.

// Convert an epoch-ms instant to a UTC YYYY-MM-DD day string. The /api/interval
// route parses `from`/`to` as UTC day bounds (Date.UTC(...,0,0,0) / 23:59:59.999),
// so we emit the UTC calendar day to stay consistent with how the route widens
// them. PURE.
export function msToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// A zoom span expressed as the route's inclusive day bounds.
export type ZoomRange = { from: string; to: string };

// Map a dragged [startMs, endMs] span to inclusive UTC day bounds for /api/interval.
// The endpoints are ordered (a backwards drag still yields from ≤ to) and each is
// snapped to its UTC calendar day; the route then widens `to` to end-of-day so the
// full last day is captured. PURE.
export function zoomSpanToRange(startMs: number, endMs: number): ZoomRange {
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  return { from: msToYmd(lo), to: msToYmd(hi) };
}

// Decide whether a drag-selection between two data points is deliberate enough to
// zoom (vs an accidental click that registered a down+up on essentially the same
// spot). A real zoom requires BOTH:
//   • the two selected indices differ (a click lands both endpoints on one point);
//   • the selected ms span is at least `minSpanMs` wide — a tiny jitter-drag
//     across two adjacent points (e.g. a few minutes at 15m grain) should not zoom.
// With an explicit drag the user is asking to zoom to exactly what they drew, so
// there is NO upper-bound / shrink gating here — any deliberate selection zooms.
// PURE — returns just the decision (the impure widget does the actual fetch).
export function isZoomSelectionSignificant(
  startIndex: number,
  endIndex: number,
  startMs: number,
  endMs: number,
  minSpanMs: number,
): boolean {
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return false;
  if (startIndex === endIndex) return false;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return Math.abs(endMs - startMs) >= minSpanMs;
}
