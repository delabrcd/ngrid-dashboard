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
import type { Notification } from '@/lib/notifications';

export function NotificationsBell({
  notifications,
  onDismiss,
}: {
  // The already-derived, already-de-dismissed list (newest first), from
  // buildNotifications. Its length IS the unread count.
  notifications: Notification[];
  // Dismiss one item by its stable key (the parent appends it to prefs).
  onDismiss: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
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
                <li
                  key={n.key}
                  className="flex items-start gap-2 border-b border-slate-800/50 px-3 py-2 last:border-b-0"
                >
                  {/* Tone dot: amber for anomalies (warning), sky for new-bill (info). */}
                  <span
                    aria-hidden
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      n.tone === 'warning' ? 'bg-amber-400' : 'bg-sky-400'
                    }`}
                  />
                  <span className="min-w-0 flex-1 text-xs leading-snug text-slate-200">{n.message}</span>
                  <button
                    type="button"
                    onClick={() => onDismiss(n.key)}
                    aria-label="Dismiss notification"
                    className="-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-slate-700/60 hover:text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
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
    </div>
  );
}
