'use client';

// The react-grid-layout host (Phase E of the UI re-architecture, issue #73; RFC
// §3.3 + Decision 2), with the PER-PAGE BOUNDED no-scroll fit from the operator's
// root-cause architecture pass. This is the component half of the layout engine:
// it takes the placed widgets, renders them through the registry inside RGL's
// Responsive grid, and at the fit breakpoint PAGINATES them like a phone home
// screen — NEVER scrolling. All the load-bearing MATH (the page partition, the
// fill-the-page rowHeight derivation, the tile-can't-straddle-a-page repair, the
// per-page rebase) lives in lib/layoutEngine.ts (pure, unit-tested); this
// component only wires RGL + a ResizeObserver to those functions.
//
// THE FIT MODEL (issue #73 root-cause fix — each page is its OWN bounded grid):
//   • The available band is measured ONCE: availH = viewportH − gridTop −
//     pagerAllowance (− the pinned strip's height when shown). gridTop is the grid
//     container's real getBoundingClientRect().top, which folds chrome + page
//     padding + the gap into one DPI-independent CSS-pixel number.
//   • computePageFit derives (R, rowHeight) from that band: R is the design
//     rows-per-page (a 2×2 of charts → 2*CHART_ROWS), reduced only if the band is
//     too short to give R rows a readable height; rowHeight = (availH −
//     (R+1)*margin)/R so EXACTLY R rows fill availH → no scroll.
//   • VIEW MODE renders ONLY the active page's widgets — that page's placements
//     REBASED to local y=0 — in an RGL of height exactly availH with maxRows = R.
//     There is NO clip window and NO translate: a tile cannot be sheared at a page
//     boundary because each page IS its own grid that exactly fits. The pager
//     (prev/next + dots) swaps which page's widgets are mounted.
//   • CUSTOMIZE MODE renders the FULL canvas (all pages stacked) with vertical
//     scroll + page-boundary guides, so every widget on every page is reachable
//     and a tile can be dragged down past a boundary onto a later page; on save
//     each tile's page comes from its `y` (clampToPages keeps it straddle-free).
//   • PINNED STAT STRIP (default on): the stat cards render in a fixed band above
//     the paged grid (always visible, not paged); only charts/panels page below.
//     Toggle it off and the stats become ordinary tiles that page with the rest.
//   • Below the fit breakpoint (mobile / md): UNCHANGED — a fixed rowHeight, the
//     page scrolls normally, NO pager.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import {
  BREAKPOINTS,
  CHART_ROWS,
  COLS,
  DEFAULT_FIT_ROWS,
  PINNED_PAGE_ROWS,
  FIT_BREAKPOINT,
  computePageFit,
  generateDefaultPlacements,
  mergePlacements,
  pageCount as computePageCount,
  paginatePlacements,
  placementsEqual,
  rebaseToLocal,
  type Breakpoint,
  type Placement,
  type Placements,
} from '@/lib/layoutEngine';
import { clampPage } from '@/lib/cockpit';
import { getWidget, type WidgetHost } from '@/lib/widgets/registry';

// WidthProvider measures the container width for us so the grid is responsive
// without a hardcoded width (the standard RGL setup). Memoized at module scope so
// it isn't re-created each render (re-creating it remounts the whole grid).
const ResponsiveGrid = WidthProvider(Responsive);

// RGL margins (px). One value reused for x and y; the fit math accounts for
// `rows + 1` of these vertically so the page height matches RGL's real spacing.
// We also pass it as containerPadding so the outer gap equals the inter-row gap
// (the assumption the fit formula folds in).
const MARGIN = 8;

// Vertical room reserved for the pager (prev/next + dots, ~28px) and the gap
// above it, subtracted from the available band so a paginated page + its pager
// still fit one viewport with no scroll. Also covers the gap between the pinned
// strip and the paged grid. A small, generous allowance — erring on the side of
// slightly shorter charts over a stray scrollbar.
const PAGER_ALLOWANCE = 44;

// The fixed, readable rowHeight used BELOW the fit breakpoint (the scrolling
// breakpoints) and on the very first paint at fit before the band is measured. At
// fit the rowHeight is DERIVED (computePageFit) so R rows exactly fill the band —
// never this constant — so there's no nominal-row guessing in the fit math.
const FALLBACK_ROW_HEIGHT = 40;

export interface WidgetLayoutProps {
  // The widget ids to place, by category, IN ORDER — the host computes these
  // from the Phase-D layout (visible charts in saved order), the visible stat
  // specs, and the bills panel. Drives both the default generator and the
  // palette's "what's currently placed vs available".
  statIds: string[];
  chartIds: string[];
  panelIds: string[];
  // Saved per-breakpoint placements (from the server layout's `layouts` blob), or
  // undefined when the account has none yet → we generate + persist the default.
  savedPlacements: Placements | undefined;
  // Persist a new placements blob (debounced PUT in useDashboardLayout).
  onPlacementsChange: (p: Placements) => void;
  // True in fit density (the old `prefs.density === 'fit'`). Only at the lg
  // breakpoint AND in fit density do we paginate + pin the page to the viewport;
  // otherwise the page scrolls (today's behaviour).
  fit: boolean;
  // Customize mode on/off — drag/resize + remove affordances + the palette.
  customizing: boolean;
  // PINNED STAT STRIP (issue #73 iteration). When true the stat widgets render in
  // a fixed band above the paged grid (always visible, not paged); when false
  // they page as ordinary tiles. From the server layout blob.
  pinnedStatStrip: boolean;
  // The registry host every widget render reads (data resolvers, configs, etc.).
  host: WidgetHost;
  // Remove a widget from the placed set (the per-widget × affordance in a cell).
  onRemoveWidget: (type: string) => void;
}

// Map RGL's 5-key breakpoint object down to our 4 (we don't use xxs). RGL still
// wants all configured breakpoints present in `cols`/`breakpoints`; we simply
// don't define xxs, so RGL never selects it.
const RGL_BREAKPOINTS = BREAKPOINTS as unknown as { [k: string]: number };
const RGL_COLS = COLS as unknown as { [k: string]: number };

export function WidgetLayout(props: WidgetLayoutProps) {
  const {
    statIds,
    chartIds,
    panelIds,
    savedPlacements,
    onPlacementsChange,
    fit,
    customizing,
    pinnedStatStrip,
    host,
  } = props;

  // The default placements that reproduce today's dashboard for the CURRENT
  // visible set. Recomputed when the set changes (a chart toggled, a card
  // appeared) so a newly-shown widget always has a default slot to fall into.
  const defaults = useMemo(
    () => generateDefaultPlacements({ statIds, chartIds, panelIds }),
    [statIds, chartIds, panelIds]
  );

  // The effective per-breakpoint layouts RGL renders: the saved placements
  // repaired against the fresh defaults (drop removed widgets, append newly-added
  // ones at their default slot), or the pure defaults when nothing is saved.
  const layouts: Placements = useMemo(
    () => mergePlacements(savedPlacements ?? {}, defaults),
    [savedPlacements, defaults]
  );

  // FIRST-LOAD PERSIST (acceptance #1 + #5): an existing user has a Phase-D
  // layout with NO `layouts` yet → generate the default and persist it ONCE so
  // they open to today's dashboard AND can then customize. Guarded by a ref so we
  // persist exactly once per mount-with-no-saved-placements.
  const placedIds = useMemo(() => [...statIds, ...chartIds, ...panelIds], [statIds, chartIds, panelIds]);
  const persistedDefault = useRef(false);
  useEffect(() => {
    if (!savedPlacements && !persistedDefault.current && placedIds.length > 0) {
      persistedDefault.current = true;
      onPlacementsChange(defaults);
    }
    if (savedPlacements) persistedDefault.current = true;
  }, [savedPlacements, defaults, onPlacementsChange, placedIds.length]);

  // ---- Active breakpoint ----
  // Default to the FIT breakpoint on the server/first paint (lg) so SSR matches
  // the common desktop case and there's no fit→scroll flash.
  const [bp, setBp] = useState<Breakpoint>(FIT_BREAKPOINT);

  // ---- Runtime chrome + viewport measurement (the no-scroll fit) ----
  // We measure the GRID CONTAINER'S TOP (its viewport-relative y, in CSS pixels)
  // AND, when the stat strip is pinned, the pinned strip's own height, so the
  // paged area's available band is computed — never a hand-tuned constant.
  //
  // WHY gridTop, NOT chromeHeight (the header-cutoff fix, CHANGE 1): the previous
  // math used `available = viewportH − chromeHeight − …`, but the grid does NOT
  // begin at `chromeHeight` from the top of the viewport — it begins below the
  // PAGE PADDING (the shell's `py-3`) AND the flex `gap` between the chrome and
  // the grid. So `viewportH − chromeHeight` over-counted the band by exactly
  // (pageTopPadding + gap) ≈ 20px: the fit math sized the page that much too tall,
  // so at the no-scroll-pinned breakpoint the page's content ran 20px past the
  // viewport and the bottom row (or, once a banner pushed the chrome down, the
  // FIRST row) was clipped behind/under the fixed chrome. Measuring the
  // container's real top via getBoundingClientRect().top folds the chrome height,
  // the page padding AND the gap into one number, so `available = viewportH −
  // gridTop − …` is exact regardless of how the chrome/padding/gap compose. It's a
  // CSS-pixel quantity (getBoundingClientRect/innerHeight are DPI-independent —
  // devicePixelRatio never enters the math), so it's robust across resolutions
  // and DPIs (CHANGE 3). gridTop is read from the container itself (always present)
  // rather than the chrome element, so a missing/late chrome can't zero it out.
  const [viewportH, setViewportH] = useState(0);
  const [gridTop, setGridTop] = useState(0);
  const [stripH, setStripH] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chrome = container.parentElement?.querySelector<HTMLElement>('[data-dashboard-chrome]') ?? null;

    // Measure into state, but only WRITE when a value actually changed — the
    // ResizeObserver fires on every layout pass (and our own re-renders resize the
    // grid, which the observer sees), so an unconditional setState would churn and
    // could feed a render→measure→render loop. The functional-update form compares
    // against the latest committed value and returns it unchanged on a no-op, so
    // React bails the re-render (the Customize-mode loop guard, kept intact).
    const measure = () => {
      // The container's TOP measured WITHOUT its own paged-grid height influencing
      // it: getBoundingClientRect().top is the distance from the viewport top to
      // the grid column's first pixel — i.e. everything above it (chrome + page
      // padding + gap). DPI-independent CSS pixels.
      const top = container.getBoundingClientRect().top;
      const sh = stripRef.current ? stripRef.current.getBoundingClientRect().height : 0;
      const vh = window.innerHeight;
      setViewportH((prev) => (prev === vh ? prev : vh));
      // Round to whole CSS pixels so sub-pixel jitter from fractional DPI scaling
      // (e.g. a 1.25× display reporting 127.5px) can't flip the value every frame
      // and re-trigger the fit recompute → a quiet, change-only update.
      setGridTop((prev) => (Math.abs(prev - top) < 0.5 ? prev : top));
      setStripH((prev) => (Math.abs(prev - sh) < 0.5 ? prev : sh));
    };
    measure();

    // Observe the chrome (so a banner appearing/dismissing remeasures the band)
    // and the pinned strip; the container itself is NOT observed — its height is
    // the fit OUTPUT, so observing it would close a measure→resize→measure loop.
    const ro = new ResizeObserver(measure);
    if (chrome) ro.observe(chrome);
    if (stripRef.current) ro.observe(stripRef.current);
    // window.resize covers viewport-height changes (which a chrome ResizeObserver
    // alone would miss — the chrome's height needn't change when the window does)
    // AND DPI/zoom changes that reflow the layout (CHANGE 3: recompute on resize).
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
    // Re-run when the pinned strip mounts/unmounts (its ref changes) so we observe
    // the right element and remeasure the band.
  }, [pinnedStatStrip, statIds.length]);

  // Only paginate (and pin the page) at the lg breakpoint in fit density.
  const fitActive = fit && bp === FIT_BREAKPOINT;

  // The stat ids that render in the PINNED band vs in the paged grid. When pinned
  // AND fit-active, stats live in the fixed strip and are excluded from the RGL
  // canvas; otherwise (unpinned, or below fit) every placed id is a grid tile.
  const pinStats = fitActive && pinnedStatStrip && statIds.length > 0;
  const gridIds = useMemo(
    () => (pinStats ? [...chartIds, ...panelIds] : placedIds),
    [pinStats, chartIds, panelIds, placedIds]
  );

  // The lg placements actually fed to the grid: the merged set, minus the pinned
  // stats (so the paged grid only sizes against charts/panels when the strip is
  // pinned). When stats ARE pinned out, the remaining charts/panels still carry
  // the stat-band's row offset (the default generator puts charts at y=STAT_ROWS),
  // so we REBASE them to start at row 0 — otherwise page 1 would waste the band
  // the (now-pinned) stat strip used to occupy. Below the fit breakpoint RGL reads
  // the per-breakpoint blob as-is.
  const gridLgPlacements = useMemo(() => {
    const lg = layouts[FIT_BREAKPOINT] ?? [];
    const keep = new Set(gridIds);
    const kept = lg.filter((p) => keep.has(p.i));
    if (!pinStats || kept.length === 0) return kept;
    const minY = Math.min(...kept.map((p) => p.y));
    return minY > 0 ? kept.map((p) => ({ ...p, y: p.y - minY })) : kept;
  }, [layouts, gridIds, pinStats]);

  // ---- The per-page bounded fit math (PURE computePageFit from layoutEngine) ----
  // availH = viewport − everything above the grid (gridTop folds in chrome + page
  // padding + the gap) − the pinned strip (when shown) − the pager band. Using
  // gridTop (not a bare chrome height) is the header-cutoff fix: the grid is sized
  // to EXACTLY the space below its own top, so the first row sits clear of the
  // chrome and the last row stops at the viewport edge — no clip, no scroll.
  const availH = Math.max(0, viewportH - gridTop - (pinStats ? stripH : 0) - PAGER_ALLOWANCE);

  // The DESIGN per-page row budget: DEFAULT_FIT_ROWS when stats page with the grid
  // (a band + two chart rows), or PINNED_PAGE_ROWS (just the two chart rows) when
  // the strip is pinned out of the paged area — so a page of charts still fills the
  // viewport as a 2×2. computePageFit honours this budget but reduces it on a short
  // viewport so the rows stay readable (it adapts, never scrolls).
  const designRows = pinStats ? PINNED_PAGE_ROWS : DEFAULT_FIT_ROWS;

  // (R, rowHeight) for the active page: R rows EXACTLY fill availH at rowHeight, so
  // a page is viewport-tall with no scroll. Before the first measure (or below the
  // fit breakpoint) we use the design budget + the fixed fallback row. When the
  // stat strip is PINNED the paged area is pure CHART rows, so we quantize R to
  // CHART_ROWS — a page holds a whole 2×2 / 1×2, never a partial chart row that
  // would straddle a boundary and leave a wasted empty band. Unpinned, the page
  // mixes a stat band with chart rows, so no quantum applies (default 1).
  const { rows: rowsPerPage, rowHeight } = useMemo(() => {
    if (!fitActive || viewportH === 0) return { rows: designRows, rowHeight: FALLBACK_ROW_HEIGHT };
    return computePageFit({ availH, designRows, marginY: MARGIN, rowQuantum: pinStats ? CHART_ROWS : 1 });
  }, [fitActive, viewportH, availH, designRows, pinStats]);

  // The page partition + count (only meaningful when fit-active). clampToPages (in
  // paginatePlacements) guarantees no tile straddles a boundary; view mode mounts
  // one page (rebased to local y=0), customize shows the whole (clamped) canvas.
  const pages = useMemo(
    () => (fitActive ? paginatePlacements(gridLgPlacements, rowsPerPage) : []),
    [fitActive, gridLgPlacements, rowsPerPage]
  );
  const totalPages = fitActive ? pages.length : 1;

  // Active page index, clamped so the pager can never select an out-of-range page
  // when the layout shrinks underneath it (the retired CockpitPager's discipline).
  const [activePage, setActivePage] = useState(0);
  const safePage = clampPage(activePage, totalPages);
  useEffect(() => {
    // Snap a now-out-of-range index back in (e.g. a removed widget collapsed a
    // page). Done in an effect so we don't setState during render.
    if (activePage !== safePage) setActivePage(safePage);
  }, [activePage, safePage]);

  // ---- RGL change handler ----
  // RGL hands us the edited layout for the active breakpoint plus the full
  // `allLayouts`. We persist the full set so every breakpoint round-trips. When
  // the stat strip is pinned, the grid only holds charts/panels, so we MERGE the
  // edited lg grid back over the pinned stats' saved placements (we don't want to
  // drop their geometry — the user may unpin later). Below fit, the grid is the
  // whole set so we persist as-is.
  //
  // THE INFINITE-LOOP FIX (issue #73). RGL fires `onLayoutChange` not just on a
  // genuine user drag/resize but on mount, breakpoint switch, vertical compaction,
  // AND every time we feed it a new `layouts` prop. Persisting from THAT handler
  // formed a feedback loop: persist → optimistic state update → re-feed RGL →
  // `onLayoutChange` → persist … . It never settled because RGL's vertical
  // compaction of an overlap-carrying layout can OSCILLATE between two equally-
  // valid packings (a 2-cycle, not a fixed point), so each re-emit genuinely
  // differs from the last → endless persists → React #185 ("maximum update depth
  // exceeded"). The robust break (how RGL apps normally persist): persist ONLY on
  // the actual user gestures — RGL's `onDragStop` / `onResizeStop` (and the
  // explicit add/remove paths) — never on the noisy `onLayoutChange`. So we use
  // `onLayoutChange` purely to CAPTURE the latest full layout into a ref (no
  // setState, no persist), and the stop handlers persist from that ref. A
  // structural-equality guard stays as a cheap belt-and-suspenders no-op filter.

  // Build the persistable per-breakpoint blob from RGL's full `allLayouts`,
  // applying the pinned-stat fold-back and the paged clamp (same transform the
  // fed layout uses, so the persisted geometry and the view-mode partition agree).
  const buildNext = (all: Layouts): Placements => {
    const next: Placements = {};
    for (const key of Object.keys(COLS) as Breakpoint[]) {
      const arr = all[key];
      if (!Array.isArray(arr)) continue;
      let edited = arr.map((l) => sanitize(l));
      // At lg, when the strip is pinned, the grid excluded the stat tiles — fold
      // their existing saved placements back so the persisted lg blob stays
      // complete (so toggling the strip back on/off, and md/sm/xs, keep the cards).
      if (key === FIT_BREAKPOINT && pinStats) {
        const prevLg = layouts[FIT_BREAKPOINT] ?? [];
        const stats = prevLg.filter((p) => statIds.includes(p.i));
        edited = [...stats, ...edited];
      }
      // Clamp the edited lg grid to pages so a tile dragged across a boundary in
      // the (scrolling) customize canvas is re-banded — keeping the view-mode
      // partition straddle-free. Only the paged (lg, fit) breakpoint is clamped.
      if (key === FIT_BREAKPOINT && fitActive) {
        const grid = edited.filter((p) => gridIds.includes(p.i));
        const rest = edited.filter((p) => !gridIds.includes(p.i));
        edited = [...rest, ...clampToPagesSafe(grid, rowsPerPage)];
      }
      next[key] = edited;
    }
    return next;
  };

  // The latest full layout RGL has emitted (its post-compaction state), captured
  // on every `onLayoutChange` so the drag/resize-STOP handlers persist exactly
  // what RGL settled on — without persisting from `onLayoutChange` itself.
  const latestAll = useRef<Layouts | null>(null);
  const onLayoutChange = (_current: Layout[], all: Layouts) => {
    latestAll.current = all;
  };

  // Persist the current layout — called ONLY from genuine user gestures (drag/
  // resize stop). Bails if customizing is off or the blob is structurally equal
  // to what's already in state (a gesture that ended where it began).
  const persistFromGesture = (all: Layouts) => {
    if (!customizing) return;
    const next = buildNext(all);
    if (placementsEqual(next, layouts)) return;
    onPlacementsChange(next);
  };
  // RGL passes the active-breakpoint layout to the stop handlers; we merge it into
  // the latest captured `allLayouts` so every breakpoint still round-trips.
  const onGestureStop = (current: Layout[]) => {
    const bpKey = bp as string;
    const all: Layouts = { ...(latestAll.current ?? {}), [bpKey]: current };
    persistFromGesture(all);
  };

  // ---- The pinned stat strip (fixed band; not in RGL) ----
  const pinnedStrip = pinStats ? (
    <div
      ref={stripRef}
      // A simple responsive flex grid of the stat cards, always visible above the
      // paged grid. shrink-0 so it keeps its measured height (the fit math
      // subtracts it from the available band). Not draggable — pinned by design;
      // unpin (Customize toggle) to rearrange them as tiles.
      // `ngrid-stat-strip` turns OFF the stat cards' size-containment here (see
      // globals.css): in the pinned strip the cards must GROW to their natural
      // content height (title + headline + bar + the possibly-wrapping sub line)
      // so NOTHING is clipped — the strip is the cards' full presentation. Size
      // containment (and the hide-the-detail container query) only applies to the
      // RESIZABLE grid tiles, where the tile dictates the height. The CSS grid's
      // equal rows make every card as tall as the tallest, so the band is uniform.
      className="ngrid-stat-strip grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8"
    >
      {statIds.map((type) => (
        <div key={type} className="min-h-[6.25rem]">
          <WidgetCell type={type} host={host} customizing={false} onRemove={() => props.onRemoveWidget(type)} />
        </div>
      ))}
    </div>
  ) : null;

  // ---- The active page's OWN layout (the keystone: a bounded, rebased grid) ----
  // VIEW MODE renders ONLY this page's widgets. paginatePlacements has already
  // clamped every tile so it sits wholly within one page band; rebaseToLocal then
  // subtracts the page's base row so the page's grid starts at y=0. Because we
  // mount just these widgets in a grid whose height is exactly availH with
  // maxRows = R, a tile CANNOT be clipped at a boundary — the page IS the grid.
  const activePagePlacements = useMemo<Placement[]>(
    () => (fitActive ? rebaseToLocal(pages[safePage] ?? [], rowsPerPage) : []),
    [fitActive, pages, safePage, rowsPerPage]
  );
  const activePageIds = useMemo(() => activePagePlacements.map((p) => p.i), [activePagePlacements]);

  // The FULL (clamped) canvas layouts for CUSTOMIZE / below-fit. At fit we feed the
  // grid-only lg placements (clamped to pages so a dragged-across tile re-bands);
  // below fit it's the merged per-breakpoint blob as-is (the page scrolls).
  const canvasLayouts: Placements = useMemo(() => {
    if (!fitActive) return layouts;
    const lg = clampToPagesSafe(gridLgPlacements, rowsPerPage);
    return { ...layouts, [FIT_BREAKPOINT]: lg };
  }, [fitActive, layouts, gridLgPlacements, rowsPerPage]);

  // A shared RGL builder so VIEW and CUSTOMIZE/scroll grids stay identical except
  // for the few axes that differ (which layout + ids, draggable, maxRows). Both
  // run FREE PLACEMENT (compactType=null + preventCollision) so tiles stay exactly
  // where placed and gaps survive the round-trip. The persist handlers only fire
  // on real gestures (drag/resize stop), so the static VIEW grid never persists.
  const buildGrid = (opts: {
    gridLayouts: Placements;
    ids: string[];
    draggable: boolean;
    maxRows?: number;
    gridKey?: string;
  }) => (
    <ResponsiveGrid
      key={opts.gridKey}
      className={`ngrid-rgl ${customizing ? 'is-customizing' : ''}`}
      layouts={opts.gridLayouts as unknown as Layouts}
      breakpoints={RGL_BREAKPOINTS}
      cols={RGL_COLS}
      rowHeight={rowHeight}
      maxRows={opts.maxRows}
      margin={[MARGIN, MARGIN]}
      containerPadding={[MARGIN, MARGIN]}
      isDraggable={opts.draggable}
      isResizable={opts.draggable}
      draggableCancel=".rgl-no-drag, button, a, input, label, select, textarea"
      // FREE PLACEMENT — the Android-home-screen model (CHANGE 2). compactType=null
      // turns OFF RGL's auto-packing so a tile stays EXACTLY where it's dropped and
      // empty cells/gaps between tiles are preserved (vertical compaction used to
      // collapse every gap upward, which is what prevented free placement).
      // preventCollision=true makes a drag/resize STOP if it would overlap another
      // tile, so tiles can't stack on top of each other — they keep their own
      // cells on the fixed 12-col × fit-rowHeight grid. Together: a fixed cell
      // matrix you can drop tiles anywhere on, with the space between them intact.
      compactType={null}
      preventCollision
      onLayoutChange={onLayoutChange}
      onDragStop={(layout) => onGestureStop(layout)}
      onResizeStop={(layout) => onGestureStop(layout)}
      onBreakpointChange={(nbp) => setBp(nbp as Breakpoint)}
      measureBeforeMount={false}
      useCSSTransforms
    >
      {opts.ids.map((type) => (
        <div key={type} className="ngrid-rgl-item">
          <WidgetCell type={type} host={host} customizing={opts.draggable} onRemove={() => props.onRemoveWidget(type)} />
        </div>
      ))}
    </ResponsiveGrid>
  );

  // VIEW MODE (fit): the active page's OWN bounded grid — its rebased placements,
  // maxRows = R. No clip window, no translate. RGL sizes its OWN height to exactly
  // R*rowHeight + (R+1)*margin, which computePageFit made == availH — so we let the
  // RGL element define the box and only `shrink-0` the wrapper so the flex column
  // can't squeeze it (squeezing would make the RGL content overflow a shorter
  // parent by a few px). RGL is keyed by page so swapping pages cleanly remounts
  // the page's children (no leftover positions from the previous page). Not
  // draggable. The wrapper is min-h-0 so it never forces the column to scroll.
  const pagedView =
    fitActive && !customizing ? (
      <div className="min-h-0 shrink-0">
        {buildGrid({
          gridLayouts: { [FIT_BREAKPOINT]: activePagePlacements },
          ids: activePageIds,
          draggable: false,
          maxRows: rowsPerPage,
          // Key by page so RGL fully remounts per page — no leftover internal
          // layout/width state from the previously-shown page bleeds in.
          gridKey: `page-${safePage}`,
        })}
      </div>
    ) : null;

  return (
    // Layout column. At fit (view mode) the parent pins the page (xl:h-dvh
    // xl:overflow-hidden), so this fills the remaining height and NEVER scrolls;
    // the pager moves between pages. In customize mode at fit, we allow the canvas
    // to scroll vertically so every page's widgets are reachable/editable, with
    // page-boundary guides. Below fit it's height:auto and the page scrolls.
    <div ref={containerRef} className={`flex min-h-0 w-full flex-col gap-2 ${fit ? 'xl:min-h-0 xl:flex-1' : ''}`}>
      {pinnedStrip}
      {pagedView ? (
        <>
          {pagedView}
          {totalPages > 1 && (
            <LayoutPager pageCount={totalPages} activePage={safePage} setPage={(u) => setActivePage((p) => u(p))} />
          )}
        </>
      ) : fitActive && customizing ? (
        // Customize canvas: scrollable, with page-boundary guide lines so the user
        // can see where each page breaks while dragging tiles across them. The
        // guides sit at each page band's pixel offset (one band = R rows + their
        // margins, the same height a VIEW page fills).
        <div className="ngrid-customize-canvas relative min-h-0 flex-1 overflow-y-auto">
          <PageGuides
            pageCount={Math.max(totalPages, computePageCount(gridLgPlacements, rowsPerPage))}
            pageStep={rowsPerPage * (rowHeight + MARGIN)}
          />
          {buildGrid({ gridLayouts: canvasLayouts, ids: gridIds, draggable: true })}
        </div>
      ) : (
        // Below the fit breakpoint (or comfortable density): the page scrolls
        // normally, no pager — today's mobile/md behaviour.
        buildGrid({ gridLayouts: canvasLayouts, ids: gridIds, draggable: customizing })
      )}
    </div>
  );
}

// Clamp wrapper that no-ops on an empty grid (paginatePlacements handles non-empty
// via clampToPages; we re-derive the clamped set here for the persisted blob + the
// fed layout so they agree). Imported clampToPages is pure; this just guards the
// rowsPerPage and keeps the call sites terse.
function clampToPagesSafe(placements: Placement[], rowsPerPage: number): Placement[] {
  if (placements.length === 0) return placements;
  // Reuse the engine's partition then flatten (it clamps internally), so a single
  // source of truth governs both the view partition and the persisted geometry.
  return paginatePlacements(placements, rowsPerPage).flat();
}

// Page-boundary guides for the customize canvas: faint dashed lines at each page
// break so the user sees where a tile spills to the next page. Pure presentational.
function PageGuides({ pageCount, pageStep }: { pageCount: number; pageStep: number }) {
  if (pageStep <= 0 || pageCount <= 1) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
      {Array.from({ length: pageCount - 1 }).map((_, i) => (
        <div
          key={i}
          // A guide sits at each page band boundary (the RGL row-band pixel
          // offset = pageStep), so it lines up with where a tile would spill.
          className="absolute left-0 right-0 border-t border-dashed border-amber-500/25"
          style={{ top: (i + 1) * pageStep }}
        >
          <span className="absolute -top-2.5 right-1 rounded bg-slate-900/80 px-1 text-[10px] text-amber-400/70">
            page {i + 2}
          </span>
        </div>
      ))}
    </div>
  );
}

// The pager controls — prev/next arrows flanking page dots + an "n / total"
// label, the retired CockpitPager's pattern (reused per the issue brief). Pure
// presentational: the active page + setter are owned by WidgetLayout.
function LayoutPager({
  pageCount,
  activePage,
  setPage,
}: {
  pageCount: number;
  activePage: number;
  setPage: (updater: (p: number) => number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 pt-0.5">
      <button
        type="button"
        aria-label="Previous page"
        onClick={() => setPage((p) => clampPage(p - 1, pageCount))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/40 text-slate-300 transition hover:bg-slate-700 hover:text-white"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: pageCount }).map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Page ${i + 1}`}
            aria-current={i === activePage}
            onClick={() => setPage(() => clampPage(i, pageCount))}
            className={`h-1.5 w-1.5 rounded-full transition ${i === activePage ? 'bg-amber-400' : 'bg-slate-600 hover:bg-slate-500'}`}
          />
        ))}
      </div>
      <span className="min-w-[3rem] text-center text-xs tabular-nums text-slate-400">
        {activePage + 1} / {pageCount}
      </span>
      <button
        type="button"
        aria-label="Next page"
        onClick={() => setPage((p) => clampPage(p + 1, pageCount))}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/40 text-slate-300 transition hover:bg-slate-700 hover:text-white"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

// Keep only the serializable placement fields off an RGL layout item (drop the
// transient `moved`/`static` RGL stamps so the persisted blob stays minimal).
function sanitize(l: Layout): Placement {
  const p: Placement = { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h };
  if (typeof l.minW === 'number') p.minW = l.minW;
  if (typeof l.minH === 'number') p.minH = l.minH;
  return p;
}

// One placed widget's cell: the registry render plus, in Customize mode, a
// remove (×) affordance overlaid in the corner. The cell fills its grid box
// (h-full) so charts/the bills rail stretch to their placed height.
function WidgetCell({
  type,
  host,
  customizing,
  onRemove,
}: {
  type: string;
  host: WidgetHost;
  customizing: boolean;
  onRemove: () => void;
}) {
  const widget = getWidget(type);
  return (
    <div className="relative h-full min-h-0 w-full">
      {customizing && (
        <button
          type="button"
          onClick={onRemove}
          title={`Remove ${widget.title}`}
          aria-label={`Remove ${widget.title}`}
          className="rgl-no-drag absolute right-1 top-1 z-20 inline-flex h-6 w-6 items-center justify-center rounded-lg border border-rose-500/50 bg-slate-900/90 text-rose-300 shadow transition hover:bg-rose-900/60 hover:text-rose-100"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      <div className={`h-full min-h-0 w-full ${customizing ? 'pointer-events-none select-none' : ''}`}>
        {widget.render(host)}
      </div>
    </div>
  );
}
