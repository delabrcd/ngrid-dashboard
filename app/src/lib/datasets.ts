// Dataset layer (Phase B of the UI re-architecture, issue #94; RFC §3.2). This
// is the seam that decouples a visualization from the concrete `MonthRow[]` the
// charts have always consumed. Today every chart assumes `MonthRow`; after this
// a widget declares the data it needs BY NAME (a `DatasetId`) and grain, and the
// HOST resolves that id → the actual rows. Phase B only wires `'monthly'` live
// (→ the same `MonthRow[]` the 7 charts already render, via the host's existing
// projection-aware adapter); the other ids exist so later phases drop in without
// re-plumbing.
//
// Keep this LIGHTWEIGHT (RFC Decision 3): it's a thin, typed naming + resolution
// layer, NOT a query engine. There is NO new API route and NO eager fetch here —
// the resolver is fed by data the dashboard already loaded.

import type { MonthRow } from '@/lib/chartSpec';

// The named datasets a widget can declare a dependency on. Grains:
//   • 'monthly'  — the per-month aggregated series (`MonthRow[]`); the existing
//                  7 charts. The ONLY dataset wired live in Phase B.
//   • 'bills'    — the raw bills list; reserved (stat/panel widgets, a future
//                  bills-table widget). Typed, not yet resolved.
//   • 'overview' — the server-computed `ov` bag the stat cards read; reserved.
//                  (Phase A stat widgets still read `ov` directly off the host;
//                  routing them through this id is a later, opt-in change.)
//   • 'interval' — FUTURE AMI smart-meter interval usage (15-min/hourly, #76).
//                  LARGE (~35k rows/yr/fuel) → must be fetched lazily, per-widget
//                  and windowed (RFC §3.6). Reserved + typed here; deliberately
//                  NOT fetched, never bundled into /api/overview.
export type DatasetId = 'monthly' | 'bills' | 'overview' | 'interval';

// A placeholder row shape for the not-yet-modeled `interval` grain. Reserved so
// the union below is total; the real `IntervalUsage` lands with #76. `unknown`
// (not `any`) keeps strict mode honest — nothing can read fields off it until
// it's properly typed, which is the point (it's never resolved in Phase B).
export type IntervalRow = unknown;

// Maps each DatasetId → the row type it resolves to. This is the single source
// of truth a `VizSpec<Row>` (chartSpec.ts) and the host resolver both align to,
// so declaring `dataset: 'monthly'` and consuming `MonthRow` can never drift.
export interface DatasetRowMap {
  monthly: MonthRow;
  // `bills`/`overview` are reserved; `unknown` until a widget actually consumes
  // them (Phase A stats still read `ov` off the host directly). Typing them as
  // `unknown` rather than their concrete shapes avoids importing the component-
  // layer `Overview`/`Bill` types into a pure lib module before anything needs
  // them — tighten when a widget first declares the dependency.
  bills: unknown;
  overview: unknown;
  interval: IntervalRow;
}

// What a widget receives for one declared dataset: an array of that dataset's
// rows. (A scalar dataset like `overview` is still typed here as `unknown[]`;
// when a widget first consumes it we'll model it precisely — for Phase B nothing
// resolves it.)
export type DatasetData<Id extends DatasetId> = DatasetRowMap[Id][];

// The host's dataset resolver: given a DatasetId (and, for the per-chart grain,
// the widget id whose projection-stripped/appended view it needs), return that
// dataset's rows. The `id` argument threads the chart id through so the host can
// preserve the issue #71 spec-stripping + #52/#71 forward-projection append that
// must stay per-chart and byte-identical (it lived in Dashboard.chartRows()).
// Phase B implements ONLY `'monthly'`; resolving any other id is a caller bug
// (the chart widgets only ever ask for their declared `'monthly'`).
export type DatasetResolver = <Id extends DatasetId>(
  dataset: Id,
  id: string
) => DatasetData<Id>;
