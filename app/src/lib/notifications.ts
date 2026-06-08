// In-app notifications model (notifications-dropdown feature).
//
// The dashboard's header bell surfaces, in-app, the SAME events the email /
// webhook / ntfy channels already send on scheduled scrapes: usage/cost
// ANOMALIES (#45) and NEW-BILL alerts (#7). This module is the PURE derivation —
// it takes the already-computed Overview (anomaly flags + the latest bill) and the
// set of locally-dismissed keys, and returns the ordered, de-dismissed list the
// bell renders. No DB / network / React here; the arithmetic-free transform is
// hand-tested in notifications.test.ts.
//
// STABLE KEYS. Each notification carries a key that's stable across reloads so a
// dismissal sticks (it's persisted in prefs, localStorage):
//   anomaly  -> `anomaly:{ym}:{fuel}:{metric}`   (one per flag)
//   new-bill -> `bill:{statementDate}`           (one for the latest bill only)
// A dismissed key never reappears; the unread badge counts only what survives the
// filter here.

import type { AnomalyResult } from './anomaly';

// The slice of Overview this module reads. Kept narrow (and structurally
// compatible with useDashboardData's Overview) so the helper stays decoupled from
// the full fetch shape and trivially testable.
export interface NotificationsOverview {
  anomalies?: AnomalyResult | null;
  latestBill?: { statementDate: string; totalDueAmount: number | null } | null;
}

export type NotificationKind = 'anomaly' | 'bill';
export type NotificationTone = 'warning' | 'info';

export interface Notification {
  // The stable dedupe/dismiss key (see the module header for the formats).
  key: string;
  kind: NotificationKind;
  // Amber for anomalies, info (sky) for new-bill items — drives the dot/styling.
  tone: NotificationTone;
  // The human-readable line. Anomalies reuse the flag's server-built message;
  // new-bill items are phrased here ("New bill: $X (Mon)").
  message: string;
  // A sortable integer, newest-first. For anomalies it's the flagged period's ym
  // (YYYYMM); for the bill it's the statement's YYYYMMDD. They're not the same
  // scale, but the bill is always rendered first below regardless (see sort).
  sortAt: number;
}

// Short month label (e.g. "Jun") from a YYYY-MM-DD statement date, without
// dragging in the locale-aware dateLabel (which would format the full date). Used
// only for the new-bill message's parenthetical.
function monthShort(statementDate: string): string {
  const m = Number(statementDate.slice(5, 7));
  const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m >= 1 && m <= 12 ? NAMES[m - 1] : '';
}

// Whole-dollar amount for the new-bill message (compact in the dropdown). Pure;
// mirrors format.ts' usd shape but stays dependency-free for the test.
function dollars(n: number | null | undefined): string {
  return n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;
}

// Build the in-app notification list from the overview and the dismissed-key set.
// Combines the latest-bill alert (one item, info) with one warning item per
// anomaly flag, drops anything whose key is dismissed, and sorts newest-first with
// the new-bill item pinned to the top (it's the freshest, most actionable event).
// PURE — same inputs always yield the same list.
export function buildNotifications(
  overview: NotificationsOverview | null | undefined,
  dismissed: string[]
): Notification[] {
  if (!overview) return [];
  const dismissedSet = new Set(dismissed);
  const out: Notification[] = [];

  // New-bill item — the most recent statement only (no per-historical-bill spam).
  const bill = overview.latestBill;
  if (bill?.statementDate) {
    const key = `bill:${bill.statementDate}`;
    if (!dismissedSet.has(key)) {
      const mon = monthShort(bill.statementDate);
      out.push({
        key,
        kind: 'bill',
        tone: 'info',
        message: `New bill: ${dollars(bill.totalDueAmount)}${mon ? ` (${mon})` : ''}`,
        sortAt: Number(bill.statementDate.replace(/-/g, '')) || 0,
      });
    }
  }

  // One anomaly item per flag, using the server-built message verbatim.
  for (const f of overview.anomalies?.flags ?? []) {
    const key = `anomaly:${f.ym}:${f.fuel}:${f.metric}`;
    if (dismissedSet.has(key)) continue;
    out.push({
      key,
      kind: 'anomaly',
      tone: 'warning',
      message: f.message,
      sortAt: f.ym,
    });
  }

  // Newest first, but always pin the new-bill item above anomalies (the bill's
  // YYYYMMDD and an anomaly's YYYYMM aren't on the same scale, and the new bill is
  // the headline event). Within a kind, higher sortAt first.
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'bill' ? -1 : 1;
    return b.sortAt - a.sortAt;
  });
}
