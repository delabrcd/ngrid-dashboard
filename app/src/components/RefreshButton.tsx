'use client';

import { useCallback, useRef, useState } from 'react';

type RunStatus = 'RUNNING' | 'SUCCESS' | 'ERROR';

export function RefreshButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const start = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setMsg('Logging in & checking National Grid…');
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (res.status === 409) {
        setMsg('A check is already running…');
      } else if (res.status === 429) {
        setBusy(false);
        setErr('Checked very recently — try again in a few minutes.');
        return;
      } else if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const { runId } = await res.json();
      if (!runId) throw new Error('No run id returned');

      stop();
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/refresh/${runId}`, { cache: 'no-store' });
          if (!r.ok) return;
          const run: { status: RunStatus; message?: string } = await r.json();
          if (run.status === 'RUNNING') {
            setMsg('Working… pulling bills, usage & PDFs');
            return;
          }
          stop();
          setBusy(false);
          if (run.status === 'SUCCESS') {
            setMsg(run.message || 'Up to date');
            onDone();
          } else {
            setErr(run.message || 'Scrape failed');
            setMsg(null);
          }
        } catch {
          /* keep polling */
        }
      }, 3000);
    } catch (e) {
      stop();
      setBusy(false);
      setErr((e as Error).message);
      setMsg(null);
    }
  }, [onDone]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn-primary" onClick={start} disabled={busy}>
        {busy ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {busy ? 'Checking…' : 'Check for new bills'}
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
      {err && <span className="max-w-xs text-right text-xs text-rose-400">{err}</span>}
    </div>
  );
}
