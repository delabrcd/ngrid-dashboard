# RFC: Modular UI / Widget Architecture

- **Status:** Draft for review (Phase 0 — no production code until this is signed off)
- **Author:** drafted by the team-lead session, 2026-06-08
- **Seed issue:** #73 (fully customizable dashboard) — this RFC expands it into the foundation
- **Designs *for*:** the AMI smart-meter interval cluster (#76–82) and every remaining analytics
  feature (#45–51), so each lands as "build the pure logic + drop in a widget."

---

## 1. Problem

Almost every remaining feature renders into the dashboard. Today the dashboard is **three
separate, partly-hardcoded UI systems** with a fragile layout, so each new feature re-touches the
UI layer by hand. We want one modular layer where adding/removing/customizing/placing UI is cheap
and where new visualization types (heatmaps, load profiles, scatter) are first-class.

### What we have today (grounded in the code)

| Concern | Where | State |
|---|---|---|
| **Charts** | `lib/chartSpec.ts` (`CHART_SPECS`) + `components/ConfigurableChart.tsx` | **Good & declarative.** A `ChartSpec` (series of `SeriesDef`) is rendered generically by one Recharts `ComposedChart`; the per-chart config menu is auto-derived (`chartCaps`). Adding a chart = adding a spec. |
| **Stat cards** | hardcoded JSX in `components/Dashboard.tsx` (lines ~433–622) | **Not modular.** 4 fixed + 4 optional cards (est-next, emissions, vs-last-year, budget), each a bespoke block with inline tooltips. Column count is a literal lookup keyed on how many optional cards exist. Not individually hideable/reorderable. |
| **Tools** | `components/ToolsModal.tsx` (Compare / SupplyWhatIf / Budget tabs) | A **third** system, launched from the header / clickable cards. |
| **Layout** | `Dashboard.tsx` + `lib/cockpit.ts` + `components/CockpitPager.tsx` | Two modes via `prefs.density`: `comfortable` (scrolling stack) and `fit` (no-scroll cockpit at ≥xl: page pinned to `h-dvh`, charts paginated 4-at-a-time in a 2×2 grid). |
| **No-scroll math** | `FILL_BODY_CLASSES` in `ConfigurableChart.tsx` | **Fragile.** Chart height is a hand-tuned magic constant `calc((100dvh − 22.5rem)/2)` where `22.5rem` ≈ the exact current chrome (header + stat strip + pager + gaps). **Any** change to the strip or layout silently breaks the no-scroll guarantee. |
| **State** | `lib/prefs.tsx` (React context + `localStorage` `ngrid-prefs-v1`) | `order: string[]`, `charts: Record<id, ChartConfig>`, `density`, `range`, projection toggles, account, notification prefs. `mergePrefs`/`mergeOrder` do careful, tested back-compat migration — **the pattern to reuse.** |
| **Data** | `components/useDashboardData.ts` | Server pre-computes everything into one `Overview` (`ov`) bag (`/api/overview`); `/api/series` returns `MonthRow[]`; `/api/bills` returns bills. Each stat card reads an `ov` field. |

### The two structural limits that force this work

1. **The chart system is welded to `MonthRow` + `ComposedChart`.** `ChartSpec.series[].key` is
   `keyof MonthRow` (monthly grain, flat keys); the renderer only does bar/line/area over a shared
   categorical x = month label. It **cannot** express a day×hour heatmap, a scatter of usage-vs-
   temperature, or an hour-of-day profile over 15-minute interval data — exactly what #76–82 need.
2. **The layout is hand-laid and height-tuned.** Stat cards are hardcoded; the no-scroll guarantee
   depends on a magic constant. "Support just about any layout" and "user-customizable placement"
   are impossible without a real layout engine.

---

## 2. Goals / Non-goals

**Goals**
- One **unified widget model**: charts, stat/KPI cards, and tools are all widgets in one registry;
  adding any of them happens in one declarative place.
- **Powerful, general visualizations**: decouple charts from `MonthRow` and from a single
  Recharts chart type so new viz types (scatter, heatmap, profile) are first-class.
- A **layout engine** supporting arbitrary layouts, drag/resize/reorder, responsive breakpoints,
  and a robust (computed, not magic-constant) **no-scroll "fit" mode**.
- **User customization**: show/hide/reorder/resize/place widgets; per-widget config; persisted and
  migration-safe so existing users keep their setup.
- Future-proof for the **AMI interval data** grain (large, lazy-fetched) without rework.

**Non-goals (v1)**
- Arbitrary **user-authored code/plugins** (see Decision 1 — security).
- Rewriting the data/scraper/number layers. **`/api/verify` stays green**; this is UI-only. The
  spec-off-`MonthRow` refactor must be render-identical for the existing 7 charts.
- Multi-user theming/sharing beyond the single-household, SSO/LAN-gated model (AGENTS.md rule 5).

---

## 3. Proposed architecture

### 3.1 Unified widget model

A **widget** is the atomic, placeable unit. Declarative descriptor + a render function:

```ts
interface WidgetDef<Config = unknown> {
  type: string;                 // registry key, e.g. 'chart', 'stat', 'tool:compare'
  title: string | ((c: Config) => string);
  category: 'chart' | 'stat' | 'tool' | 'panel';
  dataDeps: DatasetId[];        // which datasets it needs (see 3.2) — host provides them
  defaultSize: { w: number; h: number; minW?: number; minH?: number };
  configSchema?: ConfigSchema;  // optional, declarative → auto-derived config menu
  render(props: { data: WidgetData; config: Config; size: GridSize }): React.ReactNode;
}
const WIDGETS: Record<string, WidgetDef> = { /* registry */ };
```

- **Charts** become chart-widgets that *wrap the existing `ChartSpec` + `ConfigurableChart`* — we
  keep the good declarative chart layer; a chart widget is `{ type:'chart', spec }`. Adding a chart
  is still "add a spec."
- **Stat cards** get a parallel declarative `StatSpec` (label, value-selector from the data, a
  formatter from `lib/format.ts`, optional tooltip, optional `onClick → tool`). This **deletes the
  ~190 lines of hardcoded card JSX** in `Dashboard.tsx` and makes cards hideable/reorderable like
  charts.
- **Tools** register as `category:'tool'` widgets; they can be launched in a modal (as today) *and*
  optionally placed inline as panels.

`Dashboard.tsx` shrinks to a thin shell: header/banners + a `<WidgetLayout>` that reads the user's
layout, looks up each placed widget in the registry, provides its `dataDeps`, and renders it.

### 3.2 Dataset abstraction — decoupling viz from `MonthRow`

Introduce a small **dataset layer** so a widget declares the data it consumes by name and grain,
instead of every chart assuming `MonthRow`:

```ts
type DatasetId = 'monthly' | 'bills' | 'overview' | 'interval' /* #76, future */;
```

- `monthly` → today's `MonthRow[]` (the existing 7 charts migrate unchanged: `dataset:'monthly'`).
- `overview` → the server-computed `ov` bag (stat widgets read it).
- `interval` → **future** `IntervalUsage` (15-min/hourly). **Large (~35k rows/yr/fuel)** — fetched
  **lazily, per-widget, windowed** (never bundled into `/api/overview`; honor #76's tail-fetch rule).

Generalize `ChartSpec` from *"series over `MonthRow`"* to *"a **visualization** over a typed
dataset"* by adding a `vizType` + an `encoding`:

```ts
interface VizSpec<Row> {
  vizType: 'timeseries' | 'scatter' | 'heatmap' | 'profile';
  dataset: DatasetId;
  encoding: { x: keyof Row; y: ...; series?: ...; value?: ... };  // per vizType
  // 'timeseries' keeps today's SeriesDef[] shape — existing specs map 1:1.
}
```

A `vizType → renderer` registry (each renderer fed dataset + encoding). The current
`ConfigurableChart` becomes the `timeseries` renderer; `scatter` / `heatmap` / `profile` are added
when the AMI cluster needs them. This is the seam that makes #77 (load-shape, heatmap, peak) a
*widget + renderer*, not a UI rewrite.

> Keep it lightweight — a thin encoding layer, **not** a full grammar-of-graphics. See Decision 3.

### 3.3 Layout engine

Replace the hand-laid grid + magic-constant heights with a **grid layout engine** whose layout is a
serializable list of placements (`{ i, x, y, w, h }` per breakpoint) — which is also exactly the
persistence shape (3.4).

- **Edit mode** ("Customize dashboard"): drag to move, handle to resize, a widget palette to
  add/remove. View mode is static.
- **Responsive**: per-breakpoint layouts; collapse to 1 column on mobile (page scrolls < xl, as
  today).
- **No-scroll "fit" mode, done right**: compute `rowHeight = (100dvh − measuredChrome) / rows` at
  runtime (ResizeObserver on the chrome) instead of the `FILL_BODY_CLASSES` constant, and bound the
  grid to the viewport. This **removes the fragility** that makes every strip change a no-scroll
  regression risk.

See Decision 2 for the engine choice (library vs in-house).

### 3.4 State & persistence

The **dashboard definition** (which widgets, their placement, and per-widget config) is now
**server-side, per-account** (Decision 4). The shape:

```ts
interface DashboardLayout {
  layouts: Record<Breakpoint, Placement[]>;   // RGL-shaped widget placements, serializable
  widgetConfig: Record<string, unknown>;       // per-widget config (a chart's hidden series/type/
                                               // scale; a stat's chosen metric). Today's ChartConfig
                                               // becomes the chart-widget's config.
}
```

- **Storage → a JSON blob in the existing `AppSetting` key/value table, keyed per account** (e.g.
  key `dashboard.layout`, scoped the same way the budget target already is — #46 stores a per-account
  target in `AppSetting`). **Preferred because it needs NO schema change** — just new rows. *If*
  `AppSetting` is not already per-account-scoped, that's a **small additive** change (an `accountId`
  column / composite key) and therefore goes through the **migration-safety gate + pre-upgrade
  backup** (no-rollback prod) — confirm before assuming a schema touch.
- **API:** read/write via `/api/settings` (extend it) or a dedicated `/api/dashboard/layout`
  (GET/PUT, `runtime='nodejs'`, account-scoped, inherits the existing access gate — never public).
- **Async load (the real change from localStorage):** the layout now arrives like `ov` does — fetch
  it alongside the dashboard data (extend `useDashboardData`), render a skeleton until it resolves,
  and **preserve the no-first-paint-flash** behavior. SSR can hydrate from the server fetch.
- **prefs.tsx split (reconciling AGENTS.md "display prefs → localStorage"):** the *dashboard
  definition* (layout + widget config) is a shared, portable **runtime setting → server**;
  genuinely **per-browser, ephemeral** prefs (e.g. the active page, transient toggles) stay in
  `localStorage`. `prefs.tsx` keeps owning the localStorage half; a new hook/provider owns the
  server-side layout. Document the boundary so future prefs land on the right side.
- **Migration (reuse the `mergePrefs`/`mergeOrder` pattern, with tests):**
  1. If the account has **no saved server layout**, generate the default from today's default chart
     order + default stat cards, so an existing user opens to *exactly today's dashboard*, then can
     customize.
  2. **One-time `localStorage → server` import:** on first load, if a v1 `localStorage` blob exists
     (`order[]`/`charts{}`) and the server has no layout yet, map it into the server `DashboardLayout`
     and PUT it, so a returning user keeps their existing chart order/visibility/config. Mark
     imported so it doesn't clobber later server edits.
- **Per-account:** layouts are per-account from day one (multi-account installs get independent
  dashboards); a single-account install just has one.

### 3.5 Plugin / extensibility scope & security

This app shows **financial data** and is **SSO/LAN-gated by design** (AGENTS.md rule 5). The safe,
almost-certainly-intended reading of "user-customizable plugins/widgets" is a **registry of
built-in widget types** the user freely adds/removes/configures/places — where a "plugin" is a new
widget type a *developer* registers in one place. Any future end-user extensibility should stay
**declarative** (e.g. a user-defined metric card = pick a dataset field + formatter + threshold),
**never user-authored runtime code** (XSS/exfil risk; defeats the access model). See Decision 1.

### 3.6 Performance / SSR

- Widgets are client components (charts already are). **Lazy-load** heavy/below-the-fold widgets via
  `next/dynamic` (Recharts is heavy; interval heatmaps heavier).
- Keep the `/api/overview` bag for v1 (small, fast). Design `dataDeps` so data is fetched per
  dataset and **interval data is always lazy + windowed per widget** (never eagerly).
- Preserve the current SSR-stack → hydrate-to-fit approach so there's no first-paint flash.

---

## 4. Decisions (resolved 2026-06-08)

1. **Extensibility scope → built-in widget registry + declarative user-config; NO user-authored
   code.** A "plugin" is a new widget type a *developer* registers in one place; any end-user
   extensibility stays declarative (pick a dataset field + formatter + threshold). Rejected: a
   code/plugin sandbox (security, gated financial data).
2. **Layout engine → `react-grid-layout`.** Mature draggable/resizable grid: per-breakpoint
   layouts, serializable placements, compaction. The new dependency is the justified one.
3. **Visualization generalization → extend the in-house declarative spec + keep Recharts; add
   `visx` primitives only where a viz (e.g. heatmap) is genuinely awkward in Recharts.** No
   second spec-driven charting paradigm (Vega-Lite rejected).
4. **Layout persistence → server-side, per-account, NOW** (chosen over localStorage-for-v1). Layouts
   live in the DB so a user's dashboard follows them across browsers/devices and is captured by the
   existing backup. Implications, handled in §3.4: an async layout load (not synchronous like
   `localStorage`), a settings API + storage, a one-time `localStorage → server` migration, and a
   reconciliation of the AGENTS.md "display prefs → localStorage" rule.

---

## 5. Phased implementation plan (epic #73 → sub-issues)

Invisible foundations first; the **sweeping visual layout change last** (it lays over everything).
Each phase is independently shippable and visually verifiable on staging.

- **Phase A — Widget registry (no visual change).** Introduce `WidgetDef` + registry; wrap the
  existing 7 charts as chart-widgets and the existing stat cards as declarative `StatSpec` widgets;
  render through the registry in the *current* layout. Deletes the hardcoded card JSX.
  *Acceptance:* screenshot-identical to today; `/api/verify` untouched; unit tests for the registry.
- **Phase B — Dataset layer + generalize specs off `MonthRow` (no visual change).** Specs become
  generic over a dataset; existing charts consume `monthly`. Adds the seam for interval/scatter/
  heatmap. *Acceptance:* render-identical; specs typed against datasets.
- **Phase C — New visualization types.** `scatter`, `heatmap`, `profile` renderers registered by
  `vizType` (stub/sample data ok). *Acceptance:* a demo widget of each renders; unit-tested
  encoding/aggregation (pure).
- **Phase D — Server-side layout persistence (API + storage).** Add the per-account
  `DashboardLayout` storage in `AppSetting` (prefer the no-schema-change JSON-blob key; if a schema
  touch is unavoidable, it goes through the **migration-safety gate + pre-upgrade backup** and a
  manual backup before deploy) and the GET/PUT endpoint; wire the async load into `useDashboardData`
  with a skeleton + no first-paint flash; implement the default-layout generator and the one-time
  `localStorage → server` import. *Acceptance:* layout round-trips per account; existing user's
  order/visibility imported once; unit tests for the default-gen + import mapping; `/api/verify`
  untouched.
- **Phase E — Layout engine + customization (the big visual one, LAST).** Replace the fit-grid +
  pager with `react-grid-layout`; add Customize mode (drag/resize/add/remove from a widget palette);
  computed no-scroll fit (runtime `rowHeight`, no magic constant). **This is where #73 lands.**
  *Acceptance (verify on staging with screenshots):* default view identical for an existing user
  (post-migration), no page scroll at the fit target (1366×768 / 1280×800), mobile collapses
  cleanly, widgets appear in the **default** view, drag/resize/add/remove work and persist.
- **Phase F (optional, later).** User-defined declarative metric cards (pick dataset field +
  formatter + threshold); a layout-sharing/export affordance (now feasible since layouts are
  server-side). *Server-side + per-account persistence is already done in Phase D.*

After this lands, the deferred features attach as widgets: AMI #77 → heatmap/profile/peak widgets
on the `interval` dataset; #45/#46/#47/#48/#51 → stat/panel/chart widgets — no UI rework.

---

## 6. Risks & mitigations

- **Layout-engine ↔ no-scroll interaction.** *Mitigate:* spike the engine's fit-mode on staging
  early (Phase D), screenshot at 1366×768 / 1280×800.
- **Migration loses a user's customization.** *Mitigate:* `mergePrefs`-style migration with unit
  tests; default layout reproduces today's dashboard exactly. (Blast radius is small — effectively
  one operator — but the repo is public, so do it right.)
- **Two charting stacks.** *Mitigate:* prefer extending in-house / `visx` primitives over a second
  paradigm (Decision 3).
- **Interval-data weight.** *Mitigate:* `interval` widgets lazy-fetch windowed data; never eager,
  never in `/api/overview` (honors #76 good-guest rules).
- **Scope creep on "plugins."** *Mitigate:* Decision 1 fixes scope to a built-in registry.

---

## 7. Binding constraints (from AGENTS.md — carried through every phase)

- Charts stay **declarative**; don't fork bespoke chart components per feature.
- Pure number/aggregation logic stays in `lib/*` (`series.ts`/new pure modules), **unit-tested** —
  not buried in components. New viz aggregation (hour-of-day, heatmap binning) is pure + tested.
- Display prefs → `prefs.tsx` (localStorage); runtime settings → `AppSetting` + `/api/settings`.
- **No app-level auth / no exposing financial data un-gated.** No new dependency without a clear
  reason (Decisions 2–3 are the justified ones). `/api/verify` stays green — this is UI-only.
- TypeScript throughout; commits authored as the operator, **no Co-Authored-By** trailer.
```
