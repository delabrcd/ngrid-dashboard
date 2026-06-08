'use client';

// Header notifications bell + dropdown (notifications-dropdown feature). The
// in-app mirror of the email / webhook / ntfy channels: it surfaces the SAME
// events — usage/cost anomalies (#45) and new-bill alerts (#7) — as dismissable
// items, replacing the old inline amber anomaly banner. Presentation only: the
// notification list is derived by the PURE buildNotifications helper and fed in as
// a prop, and dismissal is delegated to the parent (which persists the key via
// prefs/localStorage). This component just owns open/close and renders the items.
//
// It's a plain anchored popover (no portal): a relatively-positioned wrapper with
// an absolutely-positioned panel below the button. Closes on Esc and on an
// outside click/tap; the bell is a real <button> with an aria-label that includes
// the unread count, and the count badge hides at 0.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { describeAnomaly, type Notification } from '@/lib/notifications';
import type { Bill } from './useDashboardData';
import { DetailModal } from './DetailModal';
import { usd, dateLabel } from '@/lib/format';

export function NotificationsBell({
  notifications,
  onDismiss,
  bills = [],
  onOpenCompare,
}: {
  // The already-derived, already-de-dismissed list (newest first), from
  // buildNotifications. Its length IS the unread count.
  notifications: Notification[];
  // Dismiss one item by its stable key (the parent appends it to prefs).
  onDismiss: (key: string) => void;
  // The loaded bills (for the new-bill detail: service period + PDF link, which
  // aren't on the notification's compact latestBill summary). Joined by statementDate.
  bills?: Bill[];
  // Optional cross-link from the anomaly detail to the Tools → Compare tab.
  onOpenCompare?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The notification whose detail modal is open (null = none). Clicking an item
  // sets it; the ✕ dismiss button stops propagation so it never opens the detail.
  const [detail, setDetail] = useState<Notification | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const count = notifications.length;

  // Close on Esc and on a click/tap outside the wrapper, but only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="btn relative border border-slate-700/70 bg-slate-800/40 text-slate-200 hover:bg-slate-700"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {/* Unread-count badge — hidden at 0. */}
        {count > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-4 text-slate-950">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-slate-800/70 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</span>
            {count > 0 ? <span className="text-[11px] text-slate-500">{count} new</span> : null}
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {count === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-slate-500">No new notifications</li>
            ) : (
              notifications.map((n) => (
                <li key={n.key} className="border-b border-slate-800/50 last:border-b-0">
                  {/* The whole item is a button: click / Enter / Space opens the
                      detail modal. The ✕ is a NESTED button that stops propagation
                      so dismissing never opens the detail. */}
                  <button
                    type="button"
                    onClick={() => setDetail(n)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-slate-800/50 focus:outline-none focus-visible:bg-slate-800/60"
                  >
                    {/* Tone dot: amber for anomalies (warning), sky for new-bill (info). */}
                    <span
                      aria-hidden
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        n.tone === 'warning' ? 'bg-amber-400' : 'bg-sky-400'
                      }`}
                    />
                    <span className="min-w-0 flex-1 text-xs leading-snug text-slate-200">{n.message}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(n.key);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onDismiss(n.key);
                        }
                      }}
                      aria-label="Dismiss notification"
                      className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-slate-700/60 hover:text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {/* Footer: a quiet pointer to where the email/webhook/ntfy channel toggles
              live — this dropdown is just the in-app view of those same alerts. */}
          <div className="border-t border-slate-800/70 px-3 py-2 text-[11px] text-slate-500">
            Also sent via email/webhook ·{' '}
            <Link href="/settings" className="text-amber-400 hover:underline" onClick={() => setOpen(false)}>
              Notification settings
            </Link>
          </div>
        </div>
      ) : null}

      {/* Click-to-open detail (notification-details feature). One DetailModal,
          rendered for whichever notification is selected; closes back to the open
          dropdown. The bill detail joins the loaded bills by statementDate for the
          service period + PDF link (not on the compact latestBill summary). */}
      <DetailModal
        open={detail != null}
        onClose={() => setDetail(null)}
        title={
          detail?.kind === 'anomaly' && detail.flag
            ? describeAnomaly(detail.flag).title
            : detail?.kind === 'bill'
              ? 'New bill'
              : 'Notification'
        }
      >
        {detail?.kind === 'anomaly' && detail.flag ? (
          <AnomalyDetailBody notification={detail} onOpenCompare={onOpenCompare} onClose={() => setDetail(null)} />
        ) : detail?.kind === 'bill' && detail.bill ? (
          <BillDetailBody notification={detail} bills={bills} />
        ) : null}
      </DetailModal>
    </div>
  );
}

// Anomaly breakdown body — pure presentation of describeAnomaly(flag). A headline,
// a stats list (this period vs the recent typical, the % difference, how far
// outside normal), and a factual "what this can mean" line; optionally a button to
// the Tools → Compare tab.
function AnomalyDetailBody({
  notification,
  onOpenCompare,
  onClose,
}: {
  notification: Notification;
  onOpenCompare?: () => void;
  onClose: () => void;
}) {
  const d = describeAnomaly(notification.flag!);
  return (
    <div className="space-y-3">
      <p className="text-sm leading-snug text-slate-200">{d.headline}</p>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-slate-500">This period</dt>
        <dd className="text-right font-medium text-slate-100">{d.latest}</dd>
        <dt className="text-slate-500">Recent typical (median)</dt>
        <dd className="text-right text-slate-300">{d.median}</dd>
        <dt className="text-slate-500">Difference</dt>
        <dd className="text-right text-slate-300">{d.pct}</dd>
        <dt className="text-slate-500">Outside normal</dt>
        <dd className="text-right text-slate-300">{d.deviations}</dd>
      </dl>
      <p className="text-[11px] text-slate-500">Compared as {d.metricLabel}.</p>
      <p className="rounded-lg border border-slate-800 bg-slate-800/40 p-2.5 text-xs leading-snug text-slate-300">
        {d.meaning}
      </p>
      {onOpenCompare ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenCompare();
          }}
          className="btn w-full border border-slate-700/70 bg-slate-800/40 text-xs text-slate-200 hover:bg-slate-700"
        >
          Open Compare periods
        </button>
      ) : null}
    </div>
  );
}

// New-bill summary body — amount, statement date, service period, and a View PDF
// link when one exists. The compact notification only carries the statement +
// amount, so the period and hasPdf come from the matching loaded bill (by
// statementDate); the link mirrors the bills-rail route.
function BillDetailBody({ notification, bills }: { notification: Notification; bills: Bill[] }) {
  const b = notification.bill!;
  const full = bills.find((x) => x.statementDate === b.statementDate);
  const period =
    full?.periodFrom ? `${dateLabel(full.periodFrom)} – ${dateLabel(full.periodTo)}` : '—';
  return (
    <div className="space-y-3">
      <div>
        <div className="text-2xl font-semibold text-slate-100">{usd(b.totalDueAmount)}</div>
        <div className="text-[11px] text-slate-500">Amount due</div>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-slate-500">Statement date</dt>
        <dd className="text-right text-slate-200">{dateLabel(b.statementDate)}</dd>
        <dt className="text-slate-500">Service period</dt>
        <dd className="text-right text-slate-200">{period}</dd>
      </dl>
      {full?.hasPdf ? (
        <a
          href={`/api/bills/${b.statementDate}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn block w-full border border-slate-700/70 bg-slate-800/40 text-center text-xs text-amber-400 hover:bg-slate-700 hover:text-amber-300"
        >
          View PDF
        </a>
      ) : (
        <p className="text-[11px] text-slate-500">No PDF available for this statement.</p>
      )}
    </div>
  );
}
