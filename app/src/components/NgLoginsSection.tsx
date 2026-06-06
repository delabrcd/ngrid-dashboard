'use client';

// Step 3 of the NG-login epic: in-app management for the National Grid logins
// whose passwords are stored AES-256-GCM-encrypted (see lib/crypto.ts). Adding a
// login runs a real headless pre-flight login; if National Grid demands a
// one-time passcode, this surfaces a code input and resumes the live login.
//
// Security: the password field is write-only (type=password, never pre-filled)
// and is POSTed once to start the pre-flight; the server never returns it back.
// The OTP is entered once and posted to the otp route — never persisted here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { relativeFromNow } from '@/lib/format';

interface NgLoginRow {
  id: number;
  label: string;
  username: string;
  status: string | null;
  lastVerifiedAt: string | null;
  accountCount: number;
}

type PreflightStatus = 'RUNNING' | 'AWAITING_OTP' | 'SUCCESS' | 'ERROR';

// Mask a username/email for display so a screen-share doesn't leak the full
// address. Keeps the first char + domain: `c••••@proton.me`.
function maskUsername(u: string): string {
  const at = u.indexOf('@');
  if (at <= 0) return u.length <= 2 ? u : u[0] + '••••';
  const local = u.slice(0, at);
  const domain = u.slice(at);
  const head = local[0];
  return `${head}${'•'.repeat(Math.max(2, local.length - 1))}${domain}`;
}

export function NgLoginsSection() {
  const [logins, setLogins] = useState<NgLoginRow[]>([]);
  const [secretKeyConfigured, setSecretKeyConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // Add-login form state.
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // OTP step state.
  const [preflightId, setPreflightId] = useState<string | null>(null);
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const load = useCallback(async () => {
    const r = await fetch('/api/ng-logins', { cache: 'no-store' }).then((x) => x.json());
    setLogins(r.logins || []);
    setSecretKeyConfigured(Boolean(r.secretKeyConfigured));
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    return stopPoll;
  }, [load]);

  const resetForm = () => {
    setLabel('');
    setUsername('');
    setPassword('');
  };

  // Resolve a terminal pre-flight state into UI + reload.
  const finish = useCallback(
    (status: PreflightStatus, message: string) => {
      stopPoll();
      setBusy(false);
      setAwaitingOtp(false);
      setPreflightId(null);
      setOtp('');
      if (status === 'SUCCESS') {
        setMsg(message || 'Login verified and saved.');
        setErr(null);
        resetForm();
        load();
      } else {
        setErr(message || 'Login failed.');
        setMsg(null);
      }
    },
    [load]
  );

  const poll = useCallback(
    (id: string) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/ng-logins/preflight/${id}`, { cache: 'no-store' });
          if (r.status === 404) {
            finish('ERROR', 'This login attempt expired. Please try again.');
            return;
          }
          if (!r.ok) return;
          const j: { status: PreflightStatus; message: string } = await r.json();
          if (j.status === 'AWAITING_OTP') {
            setAwaitingOtp(true);
            setMsg(j.message);
            return;
          }
          if (j.status === 'RUNNING') {
            if (!awaitingOtp) setMsg(j.message || 'Signing in…');
            return;
          }
          finish(j.status, j.message);
        } catch {
          /* keep polling */
        }
      }, 2000);
    },
    [awaitingOtp, finish]
  );

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg('Starting a login with National Grid…');
    try {
      const res = await fetch('/api/ng-logins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, username, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      // The plaintext password leaves this component here and never comes back;
      // clear it from state immediately.
      setPassword('');
      setPreflightId(j.preflightId);
      poll(j.preflightId);
    } catch (e2) {
      setBusy(false);
      setMsg(null);
      setErr((e2 as Error).message);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preflightId) return;
    setOtpBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ng-logins/preflight/${preflightId}/otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: otp }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || `HTTP ${res.status}`);
        setOtpBusy(false);
        return;
      }
      // Accepted — clear the one-time code and let the poll carry it to terminal.
      setOtp('');
      setAwaitingOtp(false);
      setMsg('Verifying the code…');
      setOtpBusy(false);
    } catch (e2) {
      setOtpBusy(false);
      setErr((e2 as Error).message);
    }
  };

  const remove = async (id: number, lbl: string) => {
    if (!window.confirm(`Remove the "${lbl}" login? Its accounts and history are kept.`)) return;
    await fetch(`/api/ng-logins/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">National Grid logins</h2>
        <p className="mt-1 text-xs text-slate-500">
          Credentials are stored encrypted (AES-256-GCM). Adding one runs a real login to verify it; if National Grid
          sends a one-time code you&apos;ll be asked for it here.
        </p>
      </div>

      {!secretKeyConfigured && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <code>NGRID_SECRET_KEY</code> isn&apos;t set, so the encrypted credential store is unavailable — you can&apos;t add a
          login until it&apos;s configured. Existing env credentials (<code>NGRID_USER</code>/<code>NGRID_PASS</code>) still work.
        </div>
      )}

      {/* Existing logins */}
      <div className="space-y-2">
        {logins.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200">{l.label}</span>
                <span className={`pill ${l.status === 'verified' ? 'border-emerald-500/40 text-emerald-300' : 'opacity-70'}`}>
                  {l.status || 'unknown'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {maskUsername(l.username)} · {l.accountCount} account{l.accountCount === 1 ? '' : 's'} · verified{' '}
                {l.lastVerifiedAt ? relativeFromNow(l.lastVerifiedAt) : 'never'}
              </div>
            </div>
            <button
              className="btn border border-slate-700/70 bg-slate-800/40 text-rose-300 hover:bg-slate-700"
              onClick={() => remove(l.id, l.label)}
            >
              Remove
            </button>
          </div>
        ))}
        {loaded && logins.length === 0 && (
          <p className="text-sm text-slate-400">No stored logins yet. Add one below to verify and save it.</p>
        )}
      </div>

      {/* Add-login form */}
      <form onSubmit={submitAdd} className="space-y-3 border-t border-slate-800 pt-4">
        <div className="text-sm font-medium text-slate-200">Add a login</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs text-slate-500">Label</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
              placeholder="Home"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy || !secretKeyConfigured}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Username (email)</span>
            <input
              type="email"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy || !secretKeyConfigured}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Password</span>
            <input
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || !secretKeyConfigured}
            />
          </label>
        </div>

        {/* One-time code step — revealed only when the pre-flight parks at OTP. */}
        {awaitingOtp && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3">
            <div className="text-sm font-medium text-amber-200">Enter the code National Grid just sent</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-40 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm tracking-widest text-slate-100 outline-none focus:border-amber-500"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                disabled={otpBusy}
              />
              <button type="button" className="btn-primary" onClick={submitOtp} disabled={otpBusy || otp.trim() === ''}>
                {otpBusy ? 'Verifying…' : 'Submit code'}
              </button>
            </div>
          </div>
        )}

        {!awaitingOtp && (
          <button type="submit" className="btn-primary" disabled={busy || !secretKeyConfigured}>
            {busy ? 'Verifying…' : 'Add login'}
          </button>
        )}

        {msg && <p className="text-xs text-slate-400">{msg}</p>}
        {err && <p className="text-xs text-rose-400">{err}</p>}
      </form>
    </section>
  );
}
