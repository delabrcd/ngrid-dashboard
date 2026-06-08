'use client';

// Generic centered detail modal (notification-details feature). A small reusable
// shell for the click-to-open notification detail views (anomaly breakdown / bill
// summary), styled to match ToolsModal.tsx / Modal.tsx: dimmed backdrop, centered
// slate panel, body-scroll lock, and close on Esc / backdrop / ✕. Presentation
// only — the caller passes the title and the body. Sized smaller than the Tools
// modal (max-w-md) since these are compact read-only summaries.
//
// Portals to <body> for the same reason Modal.tsx does (chart cards' backdrop-filter
// would otherwise trap position:fixed inside the card — see the note there).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DetailModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-[96vw] max-w-md flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/70 text-slate-400 transition hover:bg-slate-700 hover:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
