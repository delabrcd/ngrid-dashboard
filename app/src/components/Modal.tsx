'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
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

  // Portal to <body>: chart cards use backdrop-filter, which makes them the
  // containing block for position:fixed — so a non-portaled modal would be
  // confined to the card instead of covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[94vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        {children}
      </div>
    </div>,
    document.body
  );
}
